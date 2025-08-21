import { initFirebase, ref, get, update, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
console.log('✅ api/like.js导入lib/utils.js成功');

async function computeTotalLikes(postId, commentId, depth = 0) {
  if (depth > 50) {
    console.warn(`⚠️ 递归深度超过50 (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }
  try {
    const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
    const snapshot = await withTimeout(get(commentRef));
    if (!snapshot.exists()) return 0;

    const comment = snapshot.val();
    let total = comment.likes || 0;

    if (comment.children && Array.isArray(comment.children)) {
      for (const child of comment.children) {
        // 先递归计算子评论的 totalLikes
        const childTotal = await computeTotalLikes(postId, child.id, depth + 1);
        // 更新子评论的 totalLikes
        await withTimeout(update(ref(initFirebase(), `comments/${postId}/${child.id}`), { totalLikes: childTotal }));
        total += childTotal;
      }
    }

    // 更新当前评论的 totalLikes
    await withTimeout(update(commentRef, { totalLikes: total }));
    return total;
  } catch (err) {
    console.error(`❌ computeTotalLikes失败 (postId: ${postId}, commentId: ${commentId}):`, err);
    throw err;
  }
}

export async function likeComment(postId, commentId) {
  try {
    const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
    const snapshot = await withTimeout(get(commentRef));
    if (!snapshot.exists()) {
      throw Object.assign(new Error('评论不存在'), { isGhostLike: true });
    }

    // 增加 likes
    await withTimeout(runTransaction(ref(initFirebase(), `comments/${postId}/${commentId}/likes`), (current) => (current || 0) + 1));

    // 更新当前评论及其祖先的 totalLikes
    await computeTotalLikes(postId, commentId);

    // 递归更新所有祖先的 totalLikes
    async function updateAncestorsTotalLikes(currCommentId) {
      let currentId = currCommentId;
      while (currentId !== '0') {
        await computeTotalLikes(postId, currentId);
        const currSnapshot = await withTimeout(get(ref(initFirebase(), `comments/${postId}/${currentId}`)));
        if (!currSnapshot.exists()) break;
        const curr = currSnapshot.val();
        currentId = curr.parentId || '0';
      }
    }

    await updateAncestorsTotalLikes(commentId);

    // 返回更新后的 totalLikes
    const updatedSnapshot = await withTimeout(get(commentRef));
    const updatedComment = updatedSnapshot.val();
    return updatedComment.totalLikes || 0;
  } catch (err) {
    console.error(`❌ likeComment失败 (postId: ${postId}, commentId: ${commentId}):`, err);
    throw err;
  }
}

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
