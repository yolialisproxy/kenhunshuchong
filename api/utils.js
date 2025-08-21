import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, push, set, get, update, remove, query } from 'firebase/database';


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
const analytics = getAnalytics(app);
const db = getDatabase(app);

// 统一 body 解析（从 index.js 优化版）
export async function parseBody(req) {
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

// 统一 CORS 设置
export async function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export { db, analytics, ref, push, set, get, update, remove, query };
