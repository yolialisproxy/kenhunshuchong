import { db, ref, get, update, runTransaction, parseBody, setCORS } from './utils';

// 递归计算（优化：深度限止，从comments.js共享但这里复用）
async function computeTotalLikes(postId, commentId, depth = 0) {
  if (depth > 50) {
    console.warn('⚠️ 递归深度超过50');
    return 0;
  }
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) return 0;

  const comment = snapshot.val();
  let total = comment.likes || 0;

  if (comment.children && comment.children.length > 0) {
    for (const child of comment.children) {
      total += await computeTotalLikes(postId, child.id, depth + 1);
    }
  }

  await update(commentRef, { totalLikes: total });
  return total;
}

// 点赞（优化：共享compute，添加ghost check）
export async function likeComment(postId, commentId) {
  setCORS(res);

  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) throw Object.assign(new Error('评论不存在'), { isGhostLike: true });

  // 原子点赞
  await runTransaction(ref(db, `comments/${postId}/${commentId}/likes`), (current) => (current || 0) + 1);

  // 更新祖先（优化：迭代而非递归更新，避免栈深）
  async function updateAncestorsTotalLikes(currCommentId) {
    let currentId = currCommentId;
    while (currentId !== '0') {
      await computeTotalLikes(postId, currentId);
      const currSnapshot = await get(ref(db, `comments/${postId}/${currentId}`));
      if (!currSnapshot.exists()) break;
      const curr = currSnapshot.val();
      currentId = curr.parentId || '0';
    }
  }

  await updateAncestorsTotalLikes(commentId);

  const updatedSnapshot = await get(commentRef);
  return updatedSnapshot.val().totalLikes || 0;
}

// Handler
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = await parseBody(req);
  const { postId, commentId } = body;

  if (!postId || !commentId) {
    return res.status(400).json({ success: false, message: "缺少 postId 或 commentId" });
  }

  try {
    const totalLikes = await likeComment(postId, commentId);
    return res.status(200).json({ success: true, totalLikes });
  } catch (error) {
    console.error('❌ 点赞错误:', error);
    if (error.isGhostLike) {
      return res.status(410).json({ success: false, message: "评论不存在", ghostLike: true });
    }
    return res.status(500).json({ success: false, message: "点赞失败", details: error.message });
  }
}
