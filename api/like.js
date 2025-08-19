import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, runTransaction } from "firebase/database";

// 避免重复初始化
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_PROJECT_ID + ".firebaseapp.com",
  databaseURL: "https://" + process.env.FIREBASE_PROJECT_ID + ".firebaseio.com",
  projectId: process.env.FIREBASE_PROJECT_ID,
};

if (!getApps().length) {
  initializeApp(firebaseConfig);
}

export default async function handler(req, res) {
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    const { commentId } = req.body;
    if (!commentId) {
      return res.status(400).json({ success: false, message: "缺少 commentId" });
    }

    const db = getDatabase();
    const commentRef = ref(db, "comments/" + commentId + "/likes");

    // 原子操作，避免并发覆盖
    await runTransaction(commentRef, (current) => {
      return (current || 0) + 1;
    });

    res.status(200).json({ success: true, likes: (await (await import("firebase/database")).get(commentRef)).val() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
}
