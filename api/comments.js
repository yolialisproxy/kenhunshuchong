// api/comments.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, child, update } from 'firebase/database';

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

// =================== CORS helper ===================
function handleCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// =================== 提交评论 ===================
export async function submitComment(req, res) {
  handleCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { postId, name, email, comment, parentId = '0', action, commentId } = req.body;

  try {
    const commentsRef = ref(db, 'comments/' + postId);
    const snapshot = await get(commentsRef);
    let floor = 1;
    const comments = snapshot.exists() ? snapshot.val() : {};

    if (action === 'like') {
      if (!commentId) return res.status(400).json({ error: '缺少 commentId' });
      const targetRef = child(commentsRef, commentId);
      const targetSnap = await get(targetRef);
      if (!targetSnap.exists()) return res.status(404).json({ error: '评论不存在' });
      const likes = (targetSnap.val().likes || 0) + 1;
      await update(targetRef, { likes });
      return res.status(200).json({ likes });
    }

    // 普通评论
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    if (parentId === '0') {
      floor = Object.values(comments).filter(c => c.parentId === '0').length + 1;
    } else {
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
      parentId,
      floor,
    };
    await set(newCommentRef, data);
    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '无法提交评论', details: error.message });
  }
}

// =================== 获取评论 ===================
export async function getComments(req, res) {
  handleCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { postId } = req.query;
  if (!postId) return res.status(400).json({ error: '缺少 postId 参数' });

  try {
    const commentsRef = ref(db, 'comments/' + postId);
    const snapshot = await get(commentsRef);
    if (!snapshot.exists()) return res.status(200).json([]);

    const comments = snapshot.val();
    const commentMap = {};
    Object.values(comments).forEach(c => { c.children = []; commentMap[c.id] = c; });

    const tree = [];
    Object.values(commentMap).forEach(c => {
      if (c.parentId === '0') tree.push(c);
      else if (commentMap[c.parentId]) commentMap[c.parentId].children.push(c);
      else tree.push(c);
    });

    function sortComments(arr) {
      arr.sort((a, b) => a.floor - b.floor);
      arr.forEach(c => { if (c.children.length > 0) sortComments(c.children); });
    }

    sortComments(tree);
    return res.status(200).json(tree);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '无法加载评论', details: error.message });
  }
}

// =================== 删除评论 ===================
export async function deleteComment(req, res) {
  handleCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  // TODO: 实现删除逻辑
  res.status(501).json({ error: 'deleteComment 未实现' });
}

// =================== 编辑评论 ===================
export async function editComment(req, res) {
  handleCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  // TODO: 实现编辑逻辑
  res.status(501).json({ error: 'editComment 未实现' });
}
