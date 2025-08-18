import admin from "firebase-admin";

// Firebase 环境变量（Vercel 配置）
const {
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  FIREBASE_DATABASE_URL,
  FIREBASE_PROJECT_ID,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_MESSAGING_SENDER_ID,
  FIREBASE_APP_ID,
} = process.env;

// 初始化 Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(), // 使用 Vercel secret 设置 GOOGLE_APPLICATION_CREDENTIALS 或直接用 serviceAccount JSON
    databaseURL: FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();

export default async function handler(req, res) {
  const method = req.method;

  try {
    if (method === "GET") {
      const postId = req.query.postId;
      if (!postId) return res.status(400).json({ error: "postId 必须提供" });

      const snapshot = await db.ref(`comments/${postId}`).once("value");
      const comments = snapshot.val() || {};
      // 转数组并排序
      const list = Object.keys(comments).map(key => ({
        id: key,
        ...comments[key],
      })).sort((a, b) => a.date - b.date);

      return res.status(200).json({ comments: list });
    }

    if (method === "POST") {
      const { postId, name, email, comment, parentId } = req.body;

      if (!postId || !name || !email || !comment)
        return res.status(400).json({ error: "缺少必要字段" });

      const newRef = db.ref(`comments/${postId}`).push();
      const newComment = {
        name,
        email,
        comment,
        parentId: parentId || null,
        date: Date.now(),
        likes: 0,
      };

      await newRef.set(newComment);
      return res.status(200).json({ success: true, id: newRef.key });
    }

    // 点赞
    if (method === "PUT") {
      const { postId, id } = req.body;
      if (!postId || !id) return res.status(400).json({ error: "缺少 postId 或 id" });

      const commentRef = db.ref(`comments/${postId}/${id}/likes`);
      const snapshot = await commentRef.once("value");
      const likes = snapshot.val() || 0;
      await commentRef.set(likes + 1);

      return res.status(200).json({ likes: likes + 1 });
    }

    return res.status(405).json({ error: "方法不允许" });
  } catch (err) {
    console.error("Firebase Error:", err);
    return res.status(500).json({ error: "服务器错误" });
  }
}
