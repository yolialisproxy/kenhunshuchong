import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, update } from 'firebase/database';


// =================== Firebase 初始化 ===================
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

// =================== 用户注册 ===================
export async function registerUserHandler(req, res) {
  // =================== CORS ===================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "缺少用户名、邮箱或密码" });
    }

    const userRef = ref(db, `users/username` + username);
    const snapshot = await get(userRef);

    if (snapshot.exists()) {
      return res.status(409).json({ error: "用户名已存在" });
    }
    
    await set(userRef, {
      username,
      email,
      password: password,
      createdAt: Date.now(),
    });

    return res.status(200).json({ message: "注册成功" });
  } catch (err) {
    console.error("registerUserHandler error:", err);
    return res.status(500).json({ error: "服务器错误", details: err.message });
  }
}

// =================== 用户登录 ===================
export async function loginUserHandler(req, res) {
  // =================== CORS ===================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "缺少用户名或密码" });
    }

    const userRef = ref(db, `users/${username}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "用户不存在" });
    }

    const userData = snapshot.val();

    if (password != userData.password) {
      return res.status(401).json({ error: "密码错误" });
    }

    return res.status(200).json({
      message: "登录成功",
      user: { username: userData.username, email: userData.email },
    });
  } catch (err) {
    console.error("loginUserHandler error:", err);
    return res.status(500).json({ error: "服务器错误", details: err.message });
  }
}
