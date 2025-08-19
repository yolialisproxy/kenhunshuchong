// api/comments.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, query, orderByChild } from 'firebase/database';

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

  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;

    if (!postId || !name || !email || !comment) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const newCommentRef = push(commentsRef);
      const dateNow = Date.now();
      await set(newCommentRef, {
        id: newCommentRef.key,
        name,
        email,
        comment,
        date: dateNow,
        likes: 0,
      });

      return res.status(200).json({
        message: 'Comment submitted successfully',
        comment: {
          id: newCommentRef.key,
          name,
          email,
          comment,
          date: dateNow,
          likes: 0,
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Unable to submit comment', details: error.message });
    }
  }

  if (req.method === 'GET') {
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: 'Missing postId parameter' });

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const commentsQuery = query(commentsRef, orderByChild('date'));
      const snapshot = await get(commentsQuery);

      let commentsList = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        commentsList = Object.keys(data)
          .map(key => ({ id: key, ...data[key] }))
          .sort((a, b) => a.date - b.date); // 保证按时间升序
      }

      return res.status(200).json({ comments: commentsList });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Unable to fetch comments', details: error.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
