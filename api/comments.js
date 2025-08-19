import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, orderByChild, query } from 'firebase/database';

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

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // POST 提交新评论
  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const newCommentRef = push(commentsRef);
      const newComment = {
        id: newCommentRef.key,
        name,
        email,
        comment,
        date: Date.now(),
        likes: 0
      };
      await set(newCommentRef, newComment);
      return res.status(200).json(newComment);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '提交评论失败', details: err.message });
    }
  }

  // GET 加载评论
  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId) {
      return res.status(400).json({ error: '缺少 postId 参数' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const snapshot = await get(query(commentsRef, orderByChild('date')));
      const data = snapshot.val();

      if (!data) {
        return res.status(200).json([]); // 空数组
      }

      // 转换成数组并按 date 升序
      const comments = Object.values(data).sort((a, b) => a.date - b.date);
      return res.status(200).json(comments);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '加载评论失败', details: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
