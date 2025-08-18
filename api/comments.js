// api/comments.js
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, push, set, get, update } from "firebase/database";

// ========== Firebase 配置 ==========
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

if (!getApps().length) initializeApp(firebaseConfig);
const db = getDatabase();

// ========================== 辅助函数 ==========================
async function getComments(postId) {
  const snapshot = await get(ref(db, `comments/${postId}`));
  return snapshot.exists() ? Object.values(snapshot.val()) : [];
}

// ========================== API Handler ==========================
export default async function handler(req, res) {
  const { method } = req;

  if (method === "GET") {
    try {
      const { postId, page = 1, pageSize = 10 } = req.query;
      if (!postId) return res.status(400).json({ error: "缺少 postId" });

      const allComments = await getComments(postId);
      allComments.sort((a, b) => new Date(a.date) - new Date(b.date));

      const totalPages = Math.ceil(allComments.length / pageSize);
      const pagedComments = allComments.slice((page - 1) * pageSize, page * pageSize);

      res.status(200).json({ comments: pagedComments, totalPages });
    } catch (err) {
      res.status(500).json({ error: "读取评论失败" });
    }
    return;
  }

  if (method === "POST") {
    const { action } = req.query;

    // ========== 点赞 ==========
    if (action === "like") {
      try {
        const { postId, commentId } = req.body;
        if (!postId || !commentId) return res.status(400).json({ error: "缺少 postId 或 commentId" });

        const commentRef = ref(db, `comments/${postId}/${commentId}`);
        const snapshot = await get(commentRef);
        if (!snapshot.exists()) return res.status(404).json({ error: "评论不存在" });

        const commentData = snapshot.val();
        const likes = (commentData.likes || 0) + 1;
        await update(commentRef, { likes });
        res.status(200).json({ likes });
      } catch {
        res.status(500).json({ error: "点赞失败" });
      }
      return;
    }

    // ========== 新增评论 ==========
    try {
      const { postId, name, email, comment, parentId } = req.body;
      if (!postId || !name || !email || !comment) {
        return res.status(400).json({ error: "缺少必要字段" });
      }

      const newCommentRef = push(ref(db, `comments/${postId}`));
      const id = newCommentRef.key;
      const newComment = {
        id,
        name,
        email,
        comment,
        parentId: parentId || null,
        date: new Date().toISOString(),
        likes: 0,
      };

      await set(newCommentRef, newComment);
      res.status(200).json(newComment);
    } catch (err) {
      res.status(500).json({ error: "提交评论失败" });
    }
    return;
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end(`Method ${method} Not Allowed`);
}
