import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set } from 'firebase/database';

// Firebase 配置
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 处理 POST 请求
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { postId, name, email, comment } = req.body;

      // 校验请求数据
      if (!postId || !name || !email || !comment) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // 数据库引用
      const commentRef = ref(database, 'comments/' + postId);
      const newCommentRef = push(commentRef);

      // 设置评论数据
      await set(newCommentRef, {
        name,
        email,
        comment,
        date: Date.now(),
      });

      res.status(200).json({ message: 'Comment submitted successfully' });

    } catch (error) {
      console.error("Error while submitting comment:", error);
      res.status(500).json({ error: 'Failed to submit comment', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
