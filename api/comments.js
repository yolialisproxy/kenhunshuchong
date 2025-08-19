import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, update } from 'firebase/database';

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

// =================== 工具函数 ===================
export async function submitComment(req, res) {
  const { postId, name, email, comment, parentId = '0' } = req.body;
  if (!postId || !name || !email || !comment) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  try {
    const commentsRef = ref(db, 'comments/' + postId);
    const snapshot = await get(commentsRef);
    let floor = 1;

    if (snapshot.exists()) {
      const comments = snapshot.val();
      if (parentId === '0') {
        floor = Object.values(comments).filter(c => c.parentId === '0').length + 1;
      } else {
        floor = Object.values(comments).filter(c => c.parentId === parentId).length + 1;
      }
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

export async function getComments(req, res) {
  const { postId } = req.query;
  if (!postId) return res.status(400).json({ error: '缺少 postId 参数' });

  try {
    const commentsRef = ref(db, 'comments/' + postId);
    const snapshot = await get(commentsRef);
    if (!snapshot.exists()) return res.status(200).json([]);

    const comments = snapshot.val();
    const commentMap = {};
    Object.values(comments).forEach(c => {
      c.children = [];
      commentMap[c.id] = c;
    });

    const tree = [];
    Object.values(commentMap).forEach(c => {
      if (c.parentId === '0') tree.push(c);
      else if (commentMap[c.parentId]) commentMap[c.parentId].children.push(c);
      else tree.push(c); // 容错
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

export async function likeComment(req, res) {
  const { postId, commentId } = req.body;
  if (!postId || !commentId) return res.status(400).json({ error: '缺少 postId 或 commentId' });

  try {
    const commentRef = ref(db, `comments/${postId}/${commentId}`);
    const snapshot = await get(commentRef);
    if (!snapshot.exists()) return res.status(404).json({ error: '评论不存在' });

    const comment = snapshot.val();
    const newLikes = (comment.likes || 0) + 1;

    await update(commentRef, { likes: newLikes });
    return res.status(200).json({ likes: newLikes });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: '无法点赞', details: error.message });
  }
}

// ================= 可选的 DELETE/PUT =================
export async function deleteComment(req, res) {
  // 这里可以实现删除逻辑
  res.status(501).json({ error: 'deleteComment 尚未实现' });
}

export async function editComment(req, res) {
  // 这里可以实现编辑逻辑
  res.status(501).json({ error: 'editComment 尚未实现' });
}
