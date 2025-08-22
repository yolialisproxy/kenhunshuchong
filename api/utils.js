// lib/utils.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, get, update, remove, runTransaction } from 'firebase/database';
import sanitizeHtml from 'sanitize-html';
import bcrypt from 'bcrypt';

console.log('✅ lib/utils.js加载成功');

// 简单的日志记录器
const logger = {
  info: (message, meta = {}) => console.log(`[INFO] ${message}`, meta),
  warn: (message, meta = {}) => console.warn(`[WARN] ${message}`, meta),
  error: (message, meta = {}) => console.error(`[ERROR] ${message}`, meta)
};

// 配置
const CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 10,
  CACHE_TTL: 300, // 5分钟缓存
};

// 环境变量验证
function validateEnv() {
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    logger.error(`缺失env变量: ${missing.join(', ')}`);
    throw new Error(`缺失env变量: ${missing.join(', ')}`);
  }
}

// Firebase 初始化
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
      appId: process.env.FIREBASE_APP_ID
    };
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    logger.info('Firebase初始化成功');
    return db;
  } catch (err) {
    logger.error('Firebase初始化失败', { error: err.message, stack: err.stack });
    throw err;
  }
}

// 超时包装器
async function withTimeout(promise, ms = CONFIG.TIMEOUT) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase操作超时')), ms));
  return Promise.race([promise, timeout]);
}

// 输入清理
function sanitizeInput(input) {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {}
  });
}

// 输入验证
function validateInput(value, type) {
  const sanitized = sanitizeInput(value);
  switch (type) {
    case 'id': return /^[a-zA-Z0-9_-]+$/.test(sanitized);
    case 'name': return sanitized.length >= 2 && sanitized.length <= 50;
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized);
    case 'comment': return sanitized.length >= 1 && sanitized.length <= 1000;
    case 'username': return /^[a-zA-Z0-9_-]{3,20}$/.test(sanitized);
    case 'password': return sanitized.length >= 6 && sanitized.length <= 100;
    default: return false;
  }
}

// 解析请求体
async function parseBody(req) {
  let body = req.body;
  if (body && typeof body === 'object') return body;

  try {
    const contentType = req.headers['content-type'];

    // 处理JSON内容
    if (contentType?.includes('application/json')) {
      if (typeof body === 'string') {
        return JSON.parse(body);
      }
      return {};
    }

    // 处理表单数据
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      if (typeof body === 'string') {
        return Object.fromEntries(new URLSearchParams(body));
      }
      return {};
    }

    // 处理未知类型
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (err) {
        try {
          return Object.fromEntries(new URLSearchParams(body));
        } catch (err2) {
          return {};
        }
      }
    }

    return {};
  } catch (e) {
    logger.warn('Body解析失败', { error: e.message });
    return {};
  }
}

// 设置 CORS
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 计算总点赞数（统一实现）
async function computeTotalLikes(postId, commentId, depth = 0, cache = new Map()) {
  if (depth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn(`递归深度超过${CONFIG.MAX_RECURSION_DEPTH}`, { postId, commentId });
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('无效的 postId 或 commentId', { postId, commentId });
    return 0;
  }

  const cacheKey = `likes:${postId}:${commentId}`;

  try {
    const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
    const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
    if (!snapshot.exists()) {
      logger.warn('评论不存在', { postId, commentId });
      return 0;
    }

    const comment = snapshot.val();
    let total = comment.likes || 0;

    if (Array.isArray(comment.children) && comment.children.length > 0) {
      const childPromises = comment.children.map(child =>
        validateInput(child.id, 'id') ? computeTotalLikes(postId, child.id, depth + 1, cache) : Promise.resolve(0)
      );
      const childTotals = await Promise.allSettled(childPromises);
      total += childTotals.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);

      const updates = {};
      comment.children.forEach((child, idx) => {
        if (validateInput(child.id, 'id') && childTotals[idx].status === 'fulfilled') {
          updates[`comments/${postId}/${child.id}/totalLikes`] = childTotals[idx].value;
          updates[`comments/${postId}/${child.id}/lastSync`] = Date.now();
        }
      });
      if (Object.keys(updates).length > 0) {
        await withTimeout(update(ref(initFirebase()), updates), CONFIG.TIMEOUT);
      }
    }

    await withTimeout(update(commentRef, { totalLikes: total, lastSync: Date.now() }), CONFIG.TIMEOUT);
    cache.set(commentId, total);
    return total;
  } catch (err) {
    logger.error('computeTotalLikes失败', { postId, commentId, error: err.message, stack: err.stack });
    return cache.get(commentId) || 0;
  }
}

export {
  initFirebase, ref, push, set, get, update, remove, runTransaction,
  parseBody, setCORS, withTimeout, validateInput, CONFIG,
  sanitizeInput, computeTotalLikes, bcrypt
};
