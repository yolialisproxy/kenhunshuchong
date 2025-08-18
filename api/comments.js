import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get } from 'firebase/database';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const newCommentRef = push(commentsRef);
      const now = Date.now();

      await set(newCommentRef, { name, email, comment, date: now, likes: 0 });

      return res.status(200).json({
        message: 'Comment submitted successfully',
        comment: { id: newCommentRef.key, name, email, comment, date: now, likes: 0 }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '无法提交评论', details: err.message });
    }
  }

  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: '缺少 postId 参数' });

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      let snapshot;
      try {
        snapshot = await get(commentsRef);
      } catch (err) {
        // 查询索引异常，返回空数组而不是报错
        console.error('Firebase 查询错误:', err.message);
        return res.status(200).json([]);
      }

      const commentsList = snapshot.exists()
        ? Object.keys(snapshot.val()).map(key => ({ id: key, ...snapshot.val()[key] }))
        : [];

      commentsList.sort((a, b) => b.date - a.date);
      return res.status(200).json(commentsList);

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '无法获取评论', details: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
