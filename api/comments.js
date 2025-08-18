// api/comments.js
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, push, get, query, orderByChild, equalTo, limitToLast } from "firebase/database";

const {
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_DATABASE_URL,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID
} = process.env;

console.log("ENV VARS", {
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID
});

// 初始化 Firebase
if (!getApps().length) {
  initializeApp({
    apiKey: FIREBASE_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN,
    databaseURL: FIREBASE_DATABASE_URL,
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET,
    messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
    appId: FIREBASE_APP_ID
  });
}

const db = getDatabase();

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const { name, email, comment, postId, parentId = null } = req.body;
      if (!name || !email || !comment || !postId) {
        return res.status(400).json({ error: "缺少必要字段" });
      }
      const newCommentRef = push(ref(db, `comments/${postId}`));
      await newCommentRef.set({
        name,
        email,
        comment,
        parentId,
        date: Date.now(),
        likes: 0
      });
      return res.status(200).json({ message: "评论提交成功" });
    } else if (req.method === "GET") {
      const { postId, page = 1, pageSize = 10 } = req.query;
      if (!postId) return res.status(400).json({ error: "缺少 postId" });

      const postRef = ref(db, `comments/${postId}`);
      const snap = await get(postRef);
      const data = snap.val() || {};

      // 转换为数组并按时间排序
      const comments = Object.entries(data).map(([id, c]) => ({ id, ...c }))
        .sort((a, b) => b.date - a.date);

      const start = (page - 1) * pageSize;
      const paginated = comments.slice(start, start + pageSize);

      return res.status(200).json({
        comments: paginated,
        total: comments.length,
        page: Number(page),
        totalPages: Math.ceil(comments.length / pageSize)
      });
    } else {
      return res.status(405).json({ error: "仅支持 GET 和 POST" });
    }
  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(500).json({ error: "服务器错误" });
  }
}
