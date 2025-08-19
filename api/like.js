import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get } from 'firebase/database';

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
