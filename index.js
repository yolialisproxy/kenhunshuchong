import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 初始化 Firebase
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method === "GET") {
    // 获取某篇文章的评论
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: "postId required" });

    const snapshot = await db
      .collection("comments")
      .where("postId", "==", postId)
      .orderBy("createdAt", "asc")
      .get();

    const comments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(comments);
  }

  if (req.method === "POST") {
    // 新增一条评论
    const { postId, author, email, content, parentId } = req.body;
    if (!postId || !author || !content) {
      return res.status(400).json({ error: "postId, author, content required" });
    }

    const newComment = {
      postId,
      author,
      email: email || null,
      content,
      parentId: parentId || null,
      likes: 0,
      createdAt: new Date().toISOString(),
    };

    const ref = await db.collection("comments").add(newComment);
    return res.status(201).json({ id: ref.id, ...newComment });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
