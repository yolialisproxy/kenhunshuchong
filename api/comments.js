import { initializeApp } from 'firebase/app';
import { 
  getDatabase, ref, set, push, get, query, orderByChild, limitToLast 
} from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // --- 提交评论 ---
  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;

    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const commentsRef = ref(db, `comments/${postId}`);
      const newCommentRef = push(commentsRef);
      const newComment = {
        name,
        email,
        comment,
        date: Date.now(),
        likes: 0,
      };

      await set(newCommentRef, newComment);

      return res.status(200).json({
        message: 'Comment submitted successfully',
        id: newCommentRef.key,
        ...newComment,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Unable to submit comment', details: error.message });
    }
  }

  // --- 获取评论 ---
  if (req.method === 'GET') {
    try {
      const { postId } = req.query;
      if (!postId) {
        return res.status(400).json({ error: 'Missing postId parameter' });
      }

      // 默认一次取最近 20 条评论
      const commentsRef = ref(db, `comments/${postId}`);
      const commentsQuery = query(commentsRef, orderByChild('date'), limitToLast(20));
      const snapshot = await get(commentsQuery);

      if (!snapshot.exists()) {
        return res.status(200).json([]); // 没有评论时返回空数组
      }

      const commentsData = snapshot.val();
      const commentsList = Object.keys(commentsData).map(key => ({
        id: key,
        ...commentsData[key],
      }));

      // 按时间从新到旧排序
      commentsList.sort((a, b) => b.date - a.date);

      return res.status(200).json(commentsList);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Unable to fetch comments', details: error.message });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
