import { initFirebase, ref, get, update, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
console.log('✅ api/like.js导入lib/utils.js成功');

// 动态容错：重试、切换端点、降级处理
async function computeTotalLikes(postId, commentId, depth = 0, maxRetries = 3) {
  if (depth > 50) {
    console.warn(`⚠️ 递归深度超过50 (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 3000);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return 0;
      }

      const comment = snapshot.val();
      let total = comment.likes || 0;

      if (comment.children && Array.isArray(comment.children)) {
        for (const child of comment.children) {
          if (!child.id) {
            console.warn(`⚠️ 无效子评论ID (postId: ${postId}, commentId: ${commentId})`);
            continue;
          }
          const childTotal = await computeTotalLikes(postId, child.id, depth + 1, maxRetries);
          await withTimeout(update(ref(initFirebase(), `comments/${postId}/${child.id}`), { totalLikes: childTotal }), 3000);
          total += childTotal;
        }
      }

      await withTimeout(update(commentRef, { totalLikes: total, lastSync: Date.now() }), 3000);
      return total;
    } catch (err) {
      attempt++;
      console.error(`❌ computeTotalLikes尝试${attempt}失败 (postId: ${postId}, commentId: ${commentId}):`, err.stack);
      if (attempt === maxRetries) {
        console.error(`❌ computeTotalLikes失败，达到最大重试次数 (postId: ${postId}, commentId: ${commentId})`);
        throw new Error('计算总赞数失败');
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms后重试
    }
  }
}

export async function likeComment(postId, commentId, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 3000);
      if (!snapshot.exists()) {
        throw Object.assign(new Error('评论不存在'), { isGhostLike: true });
      }

      await withTimeout(runTransaction(ref(initFirebase(), `comments/${postId}/${commentId}/likes`), (current) => {
        return (current || 0) + 1;
      }), 3000);

      await computeTotalLikes(postId, commentId);

      async function updateAncestorsTotalLikes(currCommentId) {
        let currentId = currCommentId;
        while (currentId !== '0') {
          await computeTotalLikes(postId, currentId);
          const currSnapshot = await withTimeout(get(ref(initFirebase(), `comments/${postId}/${currentId}`)), 3000);
          if (!currSnapshot.exists()) break;
          const curr = currSnapshot.val();
          currentId = curr.parentId || '0';
        }
      }

      await updateAncestorsTotalLikes(commentId);

      const updatedSnapshot = await withTimeout(get(commentRef), 3000);
      const updatedComment = updatedSnapshot.val();
      return {
        likes: updatedComment.likes || 0,
        totalLikes: updatedComment.totalLikes || 0,
        comment: updatedComment
      };
    } catch (err) {
      attempt++;
      console.error(`❌ likeComment尝试${attempt}失败 (postId: ${postId}, commentId: ${commentId}):`, err.stack);
      if (err.isGhostLike) throw err;
      if (attempt === maxRetries) {
        console.error(`❌ likeComment失败，达到最大重试次数 (postId: ${postId}, commentId: ${commentId})`);
        throw new Error('点赞失败');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export default async function handler(req, res) {
  // CORS：测试阶段用*，生产阶段限制域名
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    setCORS(res);
  }

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = await parseBody(req);
    const { postId, commentId } = body;

    if (!postId || !commentId) {
      return res.status(400).json({ success: false, message: '缺少 postId 或 commentId' });
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
