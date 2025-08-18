import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";

// 从环境变量读取 service account JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// 获取评论
app.get("/api/comments", async (req, res) => {
  try {
    const snapshot = await db.collection("comments").get();
    const comments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(comments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Firebase read failed" });
  }
});

// 提交评论
app.post("/api/comments", async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection("comments").add(data);
    res.json({ id: docRef.id, ...data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Firebase write failed" });
  }
});

export default app;
