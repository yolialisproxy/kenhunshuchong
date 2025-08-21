try {
  import { db, ref, get, update, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
  console.log('✅ like.js加载并导入utils.js成功');
} catch (err) {
  console.error('❌ like.js导入utils.js失败:', err);
  throw err;
}

// 递归计算totalLikes
async function computeTotalLikes(postId, commentId, depth = 0) {
  if (depth > 50) {
    console.warn(`⚠️ 递归深度超过50 (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }
  try {
    const commentRef = ref(db(), `comments/${postId}/${commentId}`);
    const snapshot = await withTimeout(get(commentRef));
    if (!snapshot.exists()) return 0;

    const comment = snapshot.val();
    let total = comment.likes || 0;

    if (comment.children && comment.children.length > 0) {
      for (const child of comment.children) {
        total += await computeTotalLikes(postId, child.id, depth + 1);
      }
    }

    await withTimeout(update(commentRef, { totalLikes: total }));
    return total;
  } catch (err) {
    console.error(`❌ computeTotalLikes失败 (postId: ${postId}, commentId: ${commentId}):`, err);
    throw err;
  }
}

// 点赞
export async function likeComment(postId, commentId) {
  try {
    const commentRef = ref(db(), `comments/${postId}/${commentId}`);
    const snapshot = await withTimeout(get(commentRef));
    if (!snapshot.exists()) {
      throw Object.assign(new Error('评论不存在'), { isGhostLike: true });
    }

    await withTimeout(runTransaction(ref(db(), `comments/${postId}/${commentId}/likes`), (current) => (current || 0) + 1));

    async function updateAncestorsTotalLikes(currCommentId) {
      let currentId = currCommentId;
      while (currentId !== '0') {
        await computeTotalLikes(postId, currentId);
        const currSnapshot = await withTimeout(get(ref(db(), `comments/${postId}/${currentId}`)));
        if (!currSnapshot.exists()) break;
        const curr = currSnapshot.val();
        currentId = curr.parentId || '0';
      }
    }

    await updateAncestorsTotalLikes(commentId);

    const updatedSnapshot = await withTimeout(get(commentRef));
    return updatedSnapshot.val().totalLikes || 0;
  } catch (err) {
    console.error(`❌ likeComment失败 (postId: ${postId}, commentId: ${commentId}):`, err);
    throw err;
  }
}

// handler
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = await parseBody(req);
    const { postId, commentId } = body;

    if (!postId || !commentId) {
      return res.status(400).json({ success: false, message: '缺少 postId 或 commentId' });
    }

    const totalLikes = await likeComment(postId, commentId);
    return res.status(200).json({ success: true, totalLikes });
  } catch (error) {
    console.error('❌ 点赞handler错误:', error);
    if (error.isGhostLike) {
      return res.status(410).json({ success: false, message: '评论不存在', ghostLike: true });
    }
    return res.status(500).json({ success: false, message: '点赞失败', details: error.message });
  }
}
