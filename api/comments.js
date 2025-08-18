// comments.js
import admin from "firebase-admin";

// 从环境变量读取拆分的服务账号信息
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

// 初始化 Firebase
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL, // 如果你用 Realtime DB
  });
}

const db = admin.firestore(); // 如果你用 Firestore
// const db = admin.database(); // 如果你用 Realtime Database

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const { name, email, comment, slug, redirect } = req.body.fields;

      if (!name || !email || !comment || !slug) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // 写入 Firestore
      const docRef = await db.collection("comments").doc(slug).collection("comments").add({
        name,
        email,
        comment,
        date: new Date().toISOString(),
      });

      // 返回成功信息
      return res.status(200).json({ message: "Comment submitted successfully", id: docRef.id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to submit comment" });
    }
  } else if (req.method === "GET") {
    try {
      const { slug } = req.query;
      if (!slug) return res.status(400).json({ error: "Missing slug" });

      const snapshot = await db.collection("comments").doc(slug).collection("comments").orderBy("date", "desc").get();
      const comments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return res.status(200).json(comments);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch comments" });
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
