const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { commentId } = req.body;
  if (!commentId) return res.status(400).json({ error: "commentId required" });

  const ref = db.collection("comments").doc(commentId);
  await ref.update({ likes: admin.firestore.FieldValue.increment(1) });
  const doc = await ref.get();
  return res.status(200).json({ id: doc.id, ...doc.data() });
};
