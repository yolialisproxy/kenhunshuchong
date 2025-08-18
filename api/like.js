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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { commentId } = req.body;
  if (!commentId) {
    return res.status(400).json({ error: "commentId required" });
  }

  try {
    const ref = db.collection("comments").doc(commentId);

    // Firestore 原子操作：自增 1
    await ref.update({
      likes: (await ref.get()).data().likes + 1
    });

    const updated = await ref.get();
    return res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    console.error("Error liking comment:", error);
    return res.status(500).json({ error: "Failed to like comment" });
  }
}
