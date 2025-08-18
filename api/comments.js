import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push, query, orderByChild, limitToFirst, get, startAfter } from 'firebase/database';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;

    // Check required fields
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({
        error: 'Missing required fields: postId, name, email, or comment',
      });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const newCommentRef = push(commentsRef);
      await set(newCommentRef, {
        name,
        email,
        comment,
        date: Date.now(),
        likes: 0,
      });

      return res.status(200).json({
        message: 'Comment submitted successfully',
        commentId: newCommentRef.key,
        comment: {
          id: newCommentRef.key,
          name,
          email,
          comment,
          date: Date.now(),
          likes: 0,
        }
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Unable to submit comment',
        details: error.message,
      });
    }
  } 

  if (req.method === "GET") {
    try {
      const { postId } = req.query;
      if (!postId) {
        return res.status(400).json({ error: "缺少 postId 参数" });
      }

      const q = query(
        collection(db, "comments"),
        where("postId", "==", postId),
        orderBy("createdAt", "desc")
      );

      const snapshot = await getDocs(q);
      const comments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return res.status(200).json(comments);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "加载评论失败" });
    }
  }

  res.setHeader("Allow", ["POST", "GET"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId parameter' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      
      // 查询条件：按时间排序，限制每页评论数
      const commentsQuery = query(
        commentsRef,
        orderByChild('date'),
        limitToFirst(pageSize),
        startAfter((page - 1) * pageSize)
      );

      const snapshot = await get(commentsQuery);

      if (!snapshot.exists()) {
        return res.status(404).json({ error: 'No comments found' });
      }

      const comments = snapshot.val();
      const commentsList = Object.keys(comments).map(key => ({
        id: key,
        ...comments[key],
      }));

      // 计算总页数
      const totalComments = Object.keys(comments).length;
      const totalPages = Math.ceil(totalComments / pageSize);

      return res.status(200).json({ comments: commentsList, totalPages });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Unable to fetch comments',
        details: error.message,
      });
    }
  } else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}
