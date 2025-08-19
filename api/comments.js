import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push, get, query, orderByChild } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const newCommentRef = push(commentsRef);
      const newCommentData = {
        name,
        email,
        comment,
        date: Date.now(),
        likes: 0,
      };
      await set(newCommentRef, newCommentData);

      return res.status(200).json({ message: '评论提交成功', comment: { id: newCommentRef.key, ...newCommentData } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '提交失败', details: err.message });
    }
  }

  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId) {
      return res.status(400).json({ error: '缺少 postId 参数' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const snapshot = await get(query(commentsRef, orderByChild('date')));
      const commentsVal = snapshot.val() || {};
      const commentsList = Object.keys(commentsVal).map(key => ({
        id: key,
        ...commentsVal[key],
      }));
      return res.status(200).json(commentsList);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '加载评论失败', details: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
