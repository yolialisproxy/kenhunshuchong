import bcrypt from "bcryptjs";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

// =================== Firebase 初始化 ===================
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =================== 用户注册 ===================
export async function registerUser({ username, email, password }) {
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (!username || !email || !password) {
    return { status: 400, body: { error: "缺少用户名、邮箱或密码" } };
  }

  const userRef = ref(db, `users/${username}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    return { status: 409, body: { error: "用户名已存在" } };
  }

  // 邮箱唯一性检查
  const allUsersRef = ref(db, "users");
  const allUsersSnap = await get(allUsersRef);
  if (allUsersSnap.exists()) {
    const users = allUsersSnap.val();
    for (const u of Object.values(users)) {
      if (u.email === email) {
        return { status: 409, body: { error: "邮箱已被注册" } };
      }
    }
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await set(userRef, {
    username,
    email,
    password: hashedPassword,
    createdAt: Date.now(),
  });

  return { status: 200, body: { message: "注册成功" } };
}

// =================== 用户登录 ===================
export async function loginUser({ username, password }) {
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (!username || !password) {
    return { status: 400, body: { error: "缺少用户名或密码" } };
  }

  const userRef = ref(db, `users/${username}`);
  const snapshot = await get(userRef);

  if (!snapshot.exists()) {
    return { status: 404, body: { error: "用户不存在" } };
  }

  const userData = snapshot.val();
  const match = await bcrypt.compare(password, userData.password);

  if (!match) {
    return { status: 401, body: { error: "密码错误" } };
  }

  return {
    status: 200,
    body: { message: "登录成功", user: { username, email: userData.email } },
  };
}
