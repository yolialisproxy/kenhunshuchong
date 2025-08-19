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
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ================= POST 提交评论 =================
  if (req.method === 'POST') {
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
        // 如果是子楼，floor 可以根据 parentId 计算
        if (parentId === '0') {
          // 初楼，floor 为当前已有初楼数量 +1
          floor = Object.values(comments).filter(c => c.parentId === '0').length + 1;
        } else {
          // 子楼，floor 为已有子楼数量 +1
          floor =
            Object.values(comments).filter(c => c.parentId === parentId).length + 1;
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

  // ================= GET 加载评论 =================
  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId) {
      return res.status(400).json({ error: '缺少 postId 参数' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const snapshot = await get(commentsRef);

      if (!snapshot.exists()) {
        return res.status(200).json([]);
      }

      const comments = snapshot.val();
      const commentsList = Object.keys(comments)
        .map(key => comments[key])
        .sort((a, b) => {
          // 先按父楼排序，再按日期排序
          if (a.parentId === b.parentId) {
            return a.date - b.date;
          }
          if (a.parentId === '0') return -1;
          if (b.parentId === '0') return 1;
          return a.date - b.date;
        });

      return res.status(200).json(commentsList);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: '无法加载评论', details: error.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
