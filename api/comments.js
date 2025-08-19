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

  const postId = req.method === 'GET' ? req.query.postId : req.body.postId;
  if (!postId) {
    return res.status(400).json({ error: 'Missing postId parameter' });
  }

  try {
    if (req.method === 'POST') {
      const { name, email, comment } = req.body;
      if (!name || !email || !comment) {
        return res.status(400).json({ error: 'Missing name, email, or comment' });
      }

      const commentsRef = ref(db, `comments/${postId}`);
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
        }
      });
    }

    if (req.method === 'GET') {
      const commentsRef = ref(db, `comments/${postId}`);
      const q = query(commentsRef, orderByChild('date'));
      const snapshot = await get(q);

      const commentsData = snapshot.val() || {};
      const commentsList = Object.keys(commentsData).map(key => commentsData[key]);

      return res.status(200).json({ comments: commentsList });
    }

    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to fetch or submit comments', details: error.message });
  }
}
