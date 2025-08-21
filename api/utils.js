import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, update, remove, runTransaction } from 'firebase/database';

// env验证
function validateEnv() {
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    throw new Error(`缺失env变量: ${missing.join(', ')}`);
  }
}

// 延迟初始化
let app, db;
function initFirebase() {
  if (db) return db;
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
    console.log('✅ Firebase初始化成功');
    return db;
  } catch (err) {
    console.error('❌ Firebase初始化失败:', err);
    throw err;
  }
}

// 超时包装
async function withTimeout(promise, ms = 5000) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Firebase操作超时')), ms);
  });
  return Promise.race([promise, timeout]);
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
    console.warn("⚠️ Body解析失败:", e);
    return {};
  }
}

// 统一 CORS
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export { db: initFirebase, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS, withTimeout };
