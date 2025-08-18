// api/comments.js
import admin from "firebase-admin";

// 仅初始化一次，Serverless 环境下多次调用不会重复初始化
if (!admin.apps.length) {
  admin.initializeApp({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  });
}

const db = admin.database();

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // 从 Realtime Database 的 comments 节点读取所有评论
      const snapshot = await db.ref("comments").once("value");
      const data = snapshot.val() || {};

      // 转成数组，便于前端处理
      const comments = Object.entries(data).map(([id, comment]) => ({
        id,
        ...comment,
      }));

      return res.status(200).json({ comments });
    }

    // 如果不是 GET
    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("Firebase read error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
