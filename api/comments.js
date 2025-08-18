// api/comments.js
import { initializeApp, getApps, getApp } from 'firebase/app';
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

// 初始化（避免重复初始化报错）
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 提交评论
  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body || {};

    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const commentsRef = ref(db, `comments/${postId}`);
      const newRef = push(commentsRef);
      const now = Date.now();
      const payload = { name, email, comment, date: now, likes: 0 };

      await set(newRef, payload);

      return res.status(200).json({
        message: 'Comment submitted successfully',
        id: newRef.key,
        ...payload,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Unable to submit comment', details: e.message });
    }
  }

  // 获取评论（取最新 20 条，按时间倒序返回）
  if (req.method === 'GET') {
    try {
      const { postId } = req.query || {};
      if (!postId) {
        return res.status(400).json({ error: 'Missing postId parameter' });
      }

      const commentsRef = ref(db, `comments/${postId}`);
      const q = query(commentsRef, orderByChild('date'), limitToLast(20));
      const snap = await get(q);

      // 不报 404，返回空数组，方便前端处理
      if (!snap.exists()) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json([]);
      }

      const data = snap.val();
      const list = Object.keys(data).map(id => ({ id, ...data[id] }));
      // 倒序（新->旧）
      list.sort((a, b) => b.date - a.date);

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(list);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Unable to fetch comments', details: e.message });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
