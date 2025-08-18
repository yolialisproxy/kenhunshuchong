// api/comments.js
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ====== 初始化 Firebase ======
if (!getApps().length) {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
    token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
  };

  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

// ====== API Handler ======
export default async function handler(req, res) {
  const collectionName = "comments";

  if (req.method === "POST") {
    const { name, email, comment, slug } = req.body.fields || {};
    if (!name || !email || !comment || !slug) {
      return res.status(400).json({ error: "Missing fields" });
    }

    try {
      await db.collection(collectionName).doc(slug).collection("items").add({
        name,
        email,
        comment,
        date: new Date().toISOString()
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to save comment" });
    }
  }

  if (req.method === "GET") {
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: "Missing slug" });

    try {
      const snapshot = await db.collection(collectionName).doc(slug).collection("items").orderBy("date", "desc").get();
      const comments = snapshot.docs.map(doc => doc.data());
      return res.status(200).json(comments);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch comments" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
