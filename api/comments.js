// api/comments.js
import fetch from 'node-fetch';

const firebaseConfig = {
  databaseURL: process.env.FIREBASE_DATABASE_URL, // https://kenhunshuchong-default-rtdb.firebaseio.com
};

export default async function handler(req, res) {
  try {
    const { method } = req;
    if (method === 'POST') {
      const { name, email, comment, slug } = req.body.fields || {};

      if (!name || !email || !comment || !slug) {
        return res.status(400).json({ error: 'Missing required fields.' });
      }

      const data = {
        name,
        email,
        comment,
        date: new Date().toISOString(),
      };

      const url = `${firebaseConfig.databaseURL}/comments/${slug}.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Firebase write failed: ${response.statusText}`);
      }

      return res.status(200).json({ message: 'Comment submitted!' });
    } else if (method === 'GET') {
      const { slug } = req.query;
      if (!slug) return res.status(400).json({ error: 'Missing slug.' });

      const url = `${firebaseConfig.databaseURL}/comments/${slug}.json`;
      const response = await fetch(url);
      const data = await response.json();
      const comments = data ? Object.values(data) : [];

      return res.status(200).json({ comments });
    } else {
      return res.status(405).json({ error: 'Method not allowed.' });
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
