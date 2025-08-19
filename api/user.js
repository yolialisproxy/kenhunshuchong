// api/users.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, child } from "firebase/database";
import bcrypt from "bcryptjs";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ================== 辅助函数 ==================
async function usernameExists(username) {
  const snapshot = await get(ref(db, `users/${username}`));
  return snapshot.exists();
}

// ================== Handler ==================
export default async function handler(req, res) {
  // ================= CORS =================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === "POST") {
      const { action } = req.body;

      // --------- 注册 ---------
      if (action === "register") {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
          return res.status(400).json({ error: "缺少必填字段" });
        }

        if (await usernameExists(username)) {
          return res.status(409).json({ error: "用户名已存在" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await set(ref(db, `users/${username}`), {
          email,
          passwordHash,
          createdAt: Date.now(),
        });

        return res.status(200).json({ message: "注册成功" });
      }

      // --------- 登录 ---------
      else if (action === "login") {
        const { username, password } = req.body;
        if (!username || !password) {
          return res.status(400).json({ error: "缺少必填字段" });
        }

        const snapshot = await get(ref(db, `users/${username}`));
        if (!snapshot.exists()) {
          return res.status(404).json({ error: "用户不存在" });
        }

        const userData = snapshot.val();
        const passwordMatch = await bcrypt.compare(password, userData.passwordHash);
        if (!passwordMatch) {
          return res.status(401).json({ error: "密码错误" });
        }

        return res.status(200).json({ message: "登录成功", username });
      }

      else {
        return res.status(400).json({ error: "未知 action" });
      }
    }

    // --------- GET 检查用户名重复 ---------
    else if (req.method === "GET") {
      const { username } = req.query;
      if (!username) return res.status(400).json({ error: "缺少 username 参数" });

      const exists = await usernameExists(username);
      return res.status(200).json({ exists });
    }

    else {
      return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "服务器错误", details: err.message });
  }
}
