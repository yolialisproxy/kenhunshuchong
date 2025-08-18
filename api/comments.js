const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const postId = req.query.postId;
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
};
