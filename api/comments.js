import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, update, remove, runTransaction } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ================== 智能 body 解析 ==================
async function parseBody(req) {
  let body = req.body;
  if (body && typeof body === "object") return body;

  try {
    if (typeof body === "string") {
      try { return JSON.parse(body); } catch {}
      return Object.fromEntries(new URLSearchParams(body));
    }
    return {};
  } catch (e) {
    console.warn("⚠️ Body 解析失败:", e);
    return {};
  }
}

// ================== 递归计算 totalLikes ==================
async function computeTotalLikes(postId, commentId) {
  const commentRef = ref(db, `comments/${postId}/${commentId}`);
  const snapshot = await get(commentRef);
  if (!snapshot.exists()) return 0;

  const comment = snapshot.val();
  let total = comment.likes || 0;

  if (comment.children && comment.children.length > 0) {
    for (const child of comment.children) {
      total += await computeTotalLikes(postId, child.id);
    }
  }

  await update(commentRef, { totalLikes: total });
  return total;
}

// ================== 提交评论 ==================
export async function submitComment(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // 如果有父评论，需要更新父评论 totalLikes
    if (parentId !== '0') await computeTotalLikes(postId, parentId);

    return res.status(200).json(data);
  } catch (err) {
    console.error('❌ 提交评论错误:', err);
    return res.status(500).json({ error: '无法提交评论', details: err.message });
  }
}

// ================== 获取评论 ==================
export async function getComments(req, res) {
  const { postId } = req.query;
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

// ================== 删除评论（管理员权限） ==================
export async function deleteComment(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    await remove(commentRef);
    return res.status(200).json({ message: '删除成功' });
  } catch (err) {
    console.error('❌ 删除评论错误:', err);
    return res.status(500).json({ error: '删除失败', details: err.message });
  }
}

// ================== 编辑评论 ==================
export async function editComment(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

// ================== API Handler ==================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
