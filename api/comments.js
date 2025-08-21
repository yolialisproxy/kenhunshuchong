import { initFirebase, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
console.log('✅ api/comments.js导入lib/utils.js成功');

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
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export async function submitComment(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    setCORS(res);
  }

  const body = await parseBody(req);
  const { postId, name, email, comment, parentId = '0', isGuest = true } = body;

  if (!postId || !name || !email || !comment) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  let attempt = 0, maxRetries = 3;
  while (attempt < maxRetries) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), 3000);

      let floor = 1;
      if (snapshot.exists()) {
        const comments = snapshot.val();
        floor = Object.values(comments || {}).filter(c => c.parentId === parentId).length + 1;
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
        lastSync: Date.now()
      };

      await withTimeout(set(newCommentRef, data), 3000);

      if (parentId !== '0') {
        const parentChildrenRef = ref(initFirebase(), `comments/${postId}/${parentId}/children`);
        await withTimeout(runTransaction(parentChildrenRef, (current) => {
          if (!current) current = [];
          current.push({ id: newCommentRef.key });
          return current;
        }), 3000);
        await computeTotalLikes(postId, parentId);
      }

      return res.status(200).json(data);
    } catch (err) {
      attempt++;
      console.error(`❌ 提交评论尝试${attempt}失败:`, err.stack);
      if (attempt === maxRetries) {
        console.error(`❌ 提交评论失败，达到最大重试次数`);
        return res.status(503).json({ error: '无法提交评论，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export async function getComments(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    setCORS(res);
  }

  const body = await parseBody(req);
  const postId = body.postId || req.query.postId;
  if (!postId) return res.status(400).json({ error: '缺少 postId 参数' });

  let attempt = 0, maxRetries = 3;
  while (attempt < maxRetries) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), 3000);
      if (!snapshot.exists()) return res.status(200).json([]);

      const comments = snapshot.val();
      if (!comments || typeof comments !== 'object') {
        console.warn(`⚠️ comments数据无效 (postId: ${postId}):`, comments);
        return res.status(200).json([]);
      }

      const commentMap = {};
      Object.values(comments).forEach(c => {
        c.children = Array.isArray(c.children) ? c.children : [];
        c.totalLikes = c.totalLikes || 0;
        c.lastSync = c.lastSync || Date.now();
        commentMap[c.id] = c;
      });

      const tree = [];
      Object.values(commentMap).forEach(c => {
        if (c.parentId === '0') tree.push(c);
        else {
          const parent = commentMap[c.parentId];
          if (parent) {
            parent.children = Array.isArray(parent.children) ? parent.children : [];
            parent.children.push(c);
          } else {
            tree.push(c);
          }
        }
      });

      function sortComments(arr) {
        arr.sort((a, b) => (a.floor || 0) - (b.floor || 0));
        arr.forEach(c => {
          c.children = Array.isArray(c.children) ? c.children : [];
          if (c.children.length > 0) sortComments(c.children);
        });
      }
      sortComments(tree);

      return res.status(200).json(tree);
    } catch (err) {
      attempt++;
      console.error(`❌ 获取评论尝试${attempt}失败:`, err.stack);
      if (attempt === maxRetries) {
        console.error(`❌ 获取评论失败，达到最大重试次数`);
        return res.status(503).json({ error: '无法加载评论，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export async function deleteComment(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    setCORS(res);
  }

  const body = await parseBody(req);
  const { postId, commentId, username } = body;

  if (!postId || !commentId || !username) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  if (username !== 'yolialisproxy') {
    return res.status(403).json({ error: '没有权限删除评论' });
  }

  let attempt = 0, maxRetries = 3;
  while (attempt < maxRetries) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 3000);
      if (!snapshot.exists()) return res.status(404).json({ error: '评论不存在' });

      const comment = snapshot.val();
      const parentId = comment.parentId;

      await withTimeout(remove(commentRef), 3000);

      if (parentId !== '0') {
        const parentChildrenRef = ref(initFirebase(), `comments/${postId}/${parentId}/children`);
        await withTimeout(runTransaction(parentChildrenRef, (current) => {
          if (current) {
            return current.filter(child => child.id !== commentId);
          }
          return current;
        }), 3000);
        await computeTotalLikes(postId, parentId);
      }

      return res.status(200).json({ message: '删除成功' });
    } catch (err) {
      attempt++;
      console.error(`❌ 删除评论尝试${attempt}失败:`, err.stack);
      if (attempt === maxRetries) {
        console.error(`❌ 删除评论失败，达到最大重试次数`);
        return res.status(503).json({ error: '删除失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export async function editComment(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    setCORS(res);
  }

  const body = await parseBody(req);
  const { postId, commentId, comment } = body;

  if (!postId || !commentId || !comment) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  let attempt = 0, maxRetries = 3;
  while (attempt < maxRetries) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 3000);
      if (!snapshot.exists()) return res.status(404).json({ error: '评论不存在' });

      await withTimeout(update(commentRef, { comment, lastSync: Date.now() }), 3000);
      return res.status(200).json({ message: '编辑成功' });
    } catch (err) {
      attempt++;
      console.error(`❌ 编辑评论尝试${attempt}失败:`, err.stack);
      if (attempt === maxRetries) {
        console.error(`❌ 编辑评论失败，达到最大重试次数`);
        return res.status(503).json({ error: '编辑失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export default async function handler(req, res) {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else {
    setCORS(res);
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  try {
    if (req.method === 'POST') return await submitComment(req, res);
    else if (req.method === 'GET') return await getComments(req, res);
    else if (req.method === 'DELETE') return await deleteComment(req, res);
    else if (req.method === 'PUT') return await editComment(req, res);
    else {
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (err) {
    console.error('❌ 服务器错误:', err.stack);
    return res.status(503).json({ error: '服务器错误，请稍后重试', details: err.message });
  }
}
