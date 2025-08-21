import { db, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS } from './utils';

// 递归计算 totalLikes（优化：添加深度限止防溢出）
async function computeTotalLikes(postId, commentId, depth = 0) {
  if (depth > 50) { // 优化：防深树栈溢出
    console.warn('⚠️ 递归深度超过50，停止');
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

// 提交评论（优化：添加原子更新parent children）
export async function submitComment(req, res) {
  setCORS(res);

  const body = await parseBody(req);
  const { postId, name, email, comment, parentId = '0', isGuest = true } = body;

  if (!postId || !name || !email || !comment) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  try {
    const commentsRef = ref(db, `comments/${postId}`);
    const snapshot = await get(commentsRef);

    let floor = 1;
    if (snapshot.exists()) {
      const comments = snapshot.val();
      floor = Object.values(comments).filter(c => c.parentId === parentId).length + 1;
    }

    const newCommentRef = push(commentsRef);
    const data = {
      id: newCommentRef.key,
      name,
      email,
      comment,
      date: Date.now(),
      likes: 0,
      totalLikes: 0,
      parentId,
      floor,
      isGuest,
      children: [],
    };

    await set(newCommentRef, data);

    // 优化：原子添加 to parent children
    if (parentId !== '0') {
      const parentChildrenRef = ref(db, `comments/${postId}/${parentId}/children`);
      await runTransaction(parentChildrenRef, (current) => {
        if (!current) current = [];
        current.push({ id: newCommentRef.key });
        return current;
      });
      await computeTotalLikes(postId, parentId);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('❌ 提交评论错误:', err);
    return res.status(500).json({ error: '无法提交评论', details: err.message });
  }
}

// 获取评论（无变，保持构建树逻辑）
export async function getComments(req, res) {
  setCORS(res);

  const body = await parseBody(req);
  const postId = body.postId || req.query.postId;
  if (!postId) return res.status(400).json({ error: '缺少 postId 参数' });

  try {
    const commentsRef = ref(db, `comments/${postId}`);
    const snapshot = await get(commentsRef);
    if (!snapshot.exists()) return res.status(200).json([]);

    const comments = snapshot.val();
    const commentMap = {};
    Object.values(comments).forEach(c => { c.children = []; commentMap[c.id] = c; });

    const tree = [];
    Object.values(commentMap).forEach(c => {
      if (c.parentId === '0') tree.push(c);
      else {
        const parent = commentMap[c.parentId];
        if (parent) parent.children.push(c);
        else tree.push(c);
      }
    });

    function sortComments(arr) {
      arr.sort((a,b) => a.floor - b.floor);
      arr.forEach(c => { if (c.children.length>0) sortComments(c.children); });
    }
    sortComments(tree);

    return res.status(200).json(tree);
  } catch (err) {
    console.error('❌ 获取评论错误:', err);
    return res.status(500).json({ error: '无法加载评论', details: err.message });
  }
}

// 删除评论（优化：移除 from parent children，更新totalLikes）
export async function deleteComment(req, res) {
  setCORS(res);

  const body = await parseBody(req);
  const { postId, commentId, username } = body;

  if (!postId || !commentId || !username) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  if (username !== 'yolialisproxy') {
    return res.status(403).json({ error: '没有权限删除评论' });
  }

  try {
    const commentRef = ref(db, `comments/${postId}/${commentId}`);
    const snapshot = await get(commentRef);
    if (!snapshot.exists()) return res.status(404).json({ error: '评论不存在' });

    const comment = snapshot.val();
    const parentId = comment.parentId;

    await remove(commentRef);

    // 优化：移除 from parent children
    if (parentId !== '0') {
      const parentChildrenRef = ref(db, `comments/${postId}/${parentId}/children`);
      await runTransaction(parentChildrenRef, (current) => {
        if (current) {
          return current.filter(child => child.id !== commentId);
        }
        return current;
      });
      await computeTotalLikes(postId, parentId);
    }

    return res.status(200).json({ message: '删除成功' });
  } catch (err) {
    console.error('❌ 删除评论错误:', err);
    return res.status(500).json({ error: '删除失败', details: err.message });
  }
}

// 编辑评论（无变）
export async function editComment(req, res) {
  setCORS(res);

  const body = await parseBody(req);
  const { postId, commentId, comment } = body;

  if (!postId || !commentId || !comment) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    const commentRef = ref(db, `comments/${postId}/${commentId}`);
    const snapshot = await get(commentRef);
    if (!snapshot.exists()) return res.status(404).json({ error: '评论不存在' });

    await update(commentRef, { comment });
    return res.status(200).json({ message: '编辑成功' });
  } catch (err) {
    console.error('❌ 编辑评论错误:', err);
    return res.status(500).json({ error: '编辑失败', details: err.message });
  }
}

// API Handler
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'POST') return submitComment(req, res);
    else if (req.method === 'GET') return getComments(req, res);
    else if (req.method === 'DELETE') return deleteComment(req, res);
    else if (req.method === 'PUT') return editComment(req, res);
    else {
      res.setHeader('Allow', ['GET','POST','PUT','DELETE','OPTIONS']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (err) {
    console.error('❌ 服务器错误:', err);
    return res.status(500).json({ error: '服务器错误', details: err.message });
  }
}
