import { initFirebase, ref, get, update, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
console.log('✅ api/like.js导入lib/utils.js成功');

const CONFIG = {
  TIMEOUT: 3000,
  MAX_RETRIES: 3,
  MAX_RECURSION_DEPTH: 50,
};

function validateInput(input, type = 'id') {
  if (typeof input !== 'string') return false;
  if (type === 'id') return /^[a-zA-Z0-9_-]+$/.test(input);
  return true;
}

async function computeTotalLikes(postId, commentId, depth = 0, cache = new Map()) {
  if (depth > CONFIG.MAX_RECURSION_DEPTH) {
    console.warn(`⚠️ 递归深度超过${CONFIG.MAX_RECURSION_DEPTH} (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }
  if (!validateInput(postId) || !validateInput(commentId)) {
    console.error(`❌ 无效的 postId 或 commentId:`, { postId, commentId });
    return 0;
  }

  if (cache.has(commentId)) return cache.get(commentId);

  let attempt = 0;
  while (attempt < CONFIG.MAX_RETRIES) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return 0;
      }

      const comment = snapshot.val();
      let total = comment.likes || 0;

      if (Array.isArray(comment.children) && comment.children.length > 0) {
        const childPromises = comment.children.map(child =>
          validateInput(child.id) ? computeTotalLikes(postId, child.id, depth + 1, cache) : Promise.resolve(0)
        );
        const childTotals = await Promise.all(childPromises);
        total += childTotals.reduce((sum, val) => sum + val, 0);

        const updates = {};
        comment.children.forEach((child, idx) => {
          if (validateInput(child.id)) {
            updates[`comments/${postId}/${child.id}/totalLikes`] = childTotals[idx];
            updates[`comments/${postId}/${child.id}/lastSync`] = Date.now();
          }
        });
        if (Object.keys(updates).length > 0) {
          await withTimeout(update(ref(initFirebase()), updates), CONFIG.TIMEOUT);
        }
      }

      await withTimeout(update(commentRef, { totalLikes: total, lastSync: Date.now() }), CONFIG.TIMEOUT);
      cache.set(commentId, total);
      return total;
    } catch (err) {
      attempt++;
      console.error(`❌ computeTotalLikes尝试${attempt}失败 (postId: ${postId}, commentId: ${commentId}):`, err.stack);
      if (attempt === CONFIG.MAX_RETRIES) {
        console.error(`❌ computeTotalLikes失败，返回缓存或0`);
        return cache.get(commentId) || 0;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export async function likeComment(postId, commentId, maxRetries = CONFIG.MAX_RETRIES) {
  if (!validateInput(postId) || !validateInput(commentId)) {
    throw new Error('无效的 postId 或 commentId');
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        throw Object.assign(new Error('评论不存在'), { isGhostLike: true });
      }

      await withTimeout(
        runTransaction(ref(initFirebase(), `comments/${postId}/${commentId}/likes`), current => (current || 0) + 1),
        CONFIG.TIMEOUT
      );

      const totalLikes = await computeTotalLikes(postId, commentId);

      async function updateAncestorsTotalLikes(currCommentId) {
        let currentId = currCommentId;
        while (currentId !== '0') {
          await computeTotalLikes(postId, currentId);
          const currSnapshot = await withTimeout(get(ref(initFirebase(), `comments/${postId}/${currentId}`)), CONFIG.TIMEOUT);
          if (!currSnapshot.exists()) break;
          const curr = currSnapshot.val();
          currentId = curr.parentId || '0';
        }
      }

      await updateAncestorsTotalLikes(commentId);

      const updatedSnapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      const updatedComment = updatedSnapshot.val();
      return {
        likes: updatedComment.likes || 0,
        totalLikes: updatedComment.totalLikes || 0,
        comment: updatedComment,
      };
    } catch (err) {
      attempt++;
      console.error(`❌ likeComment尝试${attempt}失败 (postId: ${postId}, commentId: ${commentId}):`, err.stack);
      if (err.isGhostLike) throw err;
      if (attempt === maxRetries) throw new Error('点赞失败');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = await parseBody(req);
    const { postId, commentId } = body;

    if (!validateInput(postId) || !validateInput(commentId)) {
      return res.status(400).json({ success: false, message: '无效的 postId 或 commentId' });
    }

    const result = await likeComment(postId, commentId);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error(`❌ 点赞handler错误 (postId: ${postId}, commentId: ${commentId}):`, error.stack);
    if (error.isGhostLike) {
      return res.status(410).json({ success: false, message: '评论不存在', ghostLike: true });
    }
    return res.status(503).json({ success: false, message: '点赞失败，请稍后重试', details: error.message });
  }
}
