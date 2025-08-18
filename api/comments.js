import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, push, child } from 'firebase/database';

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
  // res.setHeader('Access-Control-Allow-Origin', 'https://kenhunshuchong.web.app'); // 或 '*'
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // 预检请求，直接返回
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
      // Create a reference to the comments path
      const commentsRef = ref(db, 'comments/' + postId);

      // Push new comment data into the database
      const newCommentRef = push(commentsRef);
      await set(newCommentRef, {
        name,
        email,
        comment,
        date: Date.now(),
      });

      return res.status(200).json({ message: 'Comment submitted successfully' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Unable to submit comment',
        details: error.message,
      });
    }
  } else if (req.method === 'GET') {
    const { postId } = req.query;

    // Check if postId is provided
    if (!postId) {
      return res.status(400).json({ error: 'Missing postId parameter' });
    }

    try {
      // Get comments from Firebase
      const commentsRef = ref(db, 'comments/' + postId);
      const snapshot = await get(commentsRef);

      if (!snapshot.exists()) {
        return res.status(404).json({ error: 'No comments found' });
      }

      const comments = snapshot.val();
      const commentsList = Object.keys(comments).map((key) => ({
        id: key,
        ...comments[key],
      }));

      return res.status(200).json({ comments: commentsList });
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
