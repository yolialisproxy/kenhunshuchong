// api/comments.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let app;

// === 初始化 Firebase Admin SDK ===
if (!getApps().length) {
  try {
    app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // 注意 privateKey 换行
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } catch (err) {
    console.error('Firebase init error:', err);
  }
}

const db = getFirestore(app);

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { name, email, comment, slug, redirect } = req.body.fields || {};

      if (!name || !email || !comment || !slug) {
        return res.status(400).json({ error: 'Missing required fields.' });
      }

      const data = {
        name,
        email,
        comment,
        date: new Date().toISOString(),
      };

      // 保存到 Firestore，collection 按文章 slug
      await db.collection('comments').doc(slug).collection('entries').add(data);

      return res.status(200).json({ message: 'Comment submitted!' });
    } else if (req.method === 'GET') {
      const { slug } = req.query;
      if (!slug) return res.status(400).json({ error: 'Missing slug.' });

      const snapshot = await db.collection('comments').doc(slug).collection('entries').orderBy('date', 'desc').get();
      const comments = snapshot.docs.map(doc => doc.data());

      return res.status(200).json({ comments });
    } else {
      return res.status(405).json({ error: 'Method not allowed.' });
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
