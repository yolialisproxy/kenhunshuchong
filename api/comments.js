import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, set, query, orderByChild, get } from "firebase/database";

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method === "POST") {
    const { postId, name, email, comment } = req.body;
    if (!postId || !name || !email || !comment)
      return res.status(400).json({ error: "缺少必要字段" });

    try {
      const commentsRef = ref(db, `comments/${postId}`);
      const newCommentRef = push(commentsRef);
      const newComment = {
        id: newCommentRef.key,
        name,
        email,
        comment,
        date: Date.now(),
        likes: 0,
      };
      await set(newCommentRef, newComment);
      res.status(200).json(newComment);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "提交失败", details: err.message });
    }
    return;
  }

  if (req.method === "GET") {
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: "缺少 postId 参数" });

    try {
      const commentsRef = ref(db, `comments/${postId}`);
      const commentsQuery = query(commentsRef, orderByChild("date"));
      const snapshot = await get(commentsQuery);
      if (!snapshot.exists()) return res.status(200).json([]); // 空数组
      const data = snapshot.val();
      const commentsList = Object.keys(data).map(key => ({ id: key, ...data[key] }));
      res.status(200).json(commentsList);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "加载失败", details: err.message });
    }
    return;
  }

  res.setHeader("Allow", ["POST", "GET"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
