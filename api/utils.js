import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, update, remove, runTransaction } from 'firebase/database';

// env验证：防崩溃
function validateEnv() {
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`缺失env变量: ${missing.join(', ')}`);
  }
}

let app, db;
try {
  validateEnv();
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} catch (err) {
  console.error('Firebase初始化失败:', err);
  throw err; // Vercel日志可见
}

// 统一 body 解析
async function parseBody(req) {
  let body = req.body;
  if (body && typeof body === "object") return body;

  try {
    if (req.headers["content-type"]?.includes("application/json")) {
      return typeof body === "string" ? JSON.parse(body) : body;
    }
    if (typeof body === "string") {
      try { return JSON.parse(body); } catch {}
      return Object.fromEntries(new URLSearchParams(body));
    }
    return {};
  } catch (e) {
    console.warn("⚠️ Body 解析失败:", e);
    return {};
  }
}

// 统一 CORS
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export { db, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS };
