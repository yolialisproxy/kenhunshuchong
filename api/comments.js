import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";

// Firebase 配置
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 处理 GET 和 POST 请求
export default async (req, res) => {
  if (req.method === "GET") {
    try {
      // 输出环境变量到网页
      const envVars = {
        FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
        FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
        FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,
        FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
        FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
        FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
        FIREBASE_APP_ID: process.env.FIREBASE_APP_ID
      };

      // 假设在数据库里能找到数据
      const comments = {
        comments: [
          { id: 1, name: "测试用户", comment: "Hello World", date: Date.now() }
        ]
      };

      // 返回数据和环境变量
      res.status(200).json({ ...comments, envVars });
    } catch (error) {
      console.error("Error during GET:", error);
      res.status(500).json({ error: "读取数据失败" });
    }
  } else if (req.method === "POST") {
    try {
      // 获取请求体数据
      const { postId, name, email, comment } = req.body;

      // 打印收到的请求数据，用于调试
      console.log("收到的请求数据:", { postId, name, email, comment });

      // 检查必填字段
      if (!postId || !name || !comment) {
        console.error("缺少必填字段");
        return res.status(400).json({ error: "缺少必填字段" });
      }

      // 向 Firebase 写入评论数据
      const commentRef = ref(db, "comments/" + postId);
      await set(commentRef, {
        name,
        email,
        comment,
        date: Date.now(),
      });

      // 返回成功响应
      res.status(201).json({ message: "评论已提交" });
    } catch (error) {
      console.error("Error during POST:", error);  // 打印错误信息
      res.status(500).json({ error: "服务器错误" });
    }
  } else {
    res.status(405).json({ error: "不支持的请求方法" });
  }
};
