import admin from "firebase-admin";
import Cors from "cors";

// 初始化 CORS
const cors = Cors({ origin: true });

// 初始化 Firebase
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.FIREBASE_TYPE,
      project_id: process.FIREBASE_PROJECT_ID,
      private_key_id: process.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      client_email: process.FIREBASE_CLIENT_EMAIL,
      client_id: process.FIREBASE_CLIENT_ID,
      auth_uri: process.FIREBASE_AUTH_URI,
      token_uri: process.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.FIREBASE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.FIREBASE_CLIENT_CERT_URL
    }),
    databaseURL: process.FIREBASE_DATABASE_URL
  });
}

const db = admin.firestore();

// 帮助函数：等待 CORS 完成
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) reject(result);
      else resolve(result);
    });
  });
}

// API 处理
export default async function handler(req, res) {
  await runMiddleware(req, res, cors);

  if (req.method === "POST") {
    try {
      const { name, email, comment, slug } = req.body.fields || {};

      if (!name || !email || !comment || !slug) {
        return res.status(400).json({ error: "缺少必填字段" });
      }

      const newComment = {
        name,
        email,
        comment,
        slug,
        date: new Date().toISOString(),
        approved: false
      };

      await db.collection("comments").add(newComment);

      return res.status(200).json({ message: "评论已提交，待审核" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "服务器错误" });
    }
  } else if (req.method === "GET") {
    try {
      const slug = req.query.slug;
      if (!slug) return res.status(400).json({ error: "缺少 slug 参数" });

      const snapshot = await db
        .collection("comments")
        .where("slug", "==", slug)
        .where("approved", "==", true)
        .orderBy("date", "desc")
        .get();

      const comments = snapshot.docs.map((doc) => doc.data());
      return res.status(200).json({ comments });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "服务器错误" });
    }
  } else {
    res.setHeader("Allow", ["POST", "GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
