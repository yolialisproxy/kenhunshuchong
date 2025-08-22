import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  push,
  set,
  get,
  update,
  remove,
  runTransaction
} from 'firebase/database';
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

// 模块功能说明
// ============
// 这是博客项目的数据库操作模块，负责与Firebase Realtime Database的交互
// 提供基础的数据读写、事务操作、错误处理等功能
// 作者：Your Name [4]
// 版本：1.2.0
// 最后修改日期：2025-08-16

// 初始化 Firebase 应用
let app, db;

/**
 * 验证环境变量
 * 检查所有必要的环境变量是否存在
 * @throws {Error} 如果有缺失的环境变量
 */
function validateEnv() {
  const required = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    console.error(`❌ 缺失env变量: ${missing.join(', ')}`);
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

/**
 * 初始化Firebase数据库
 * @returns {Promise<Database>} 数据库实例
 */
export async function initFirebase() {
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
    console.log('✅ Firebase初始化成功');
    return db;
  } catch (err) {
    console.error('❌ Firebase初始化失败:', err);
    throw err;
  }
}

/**
 * 数据库操作超时控制
 * @template T
 * @param {Promise<T>} promise - 待执行的Promise
 * @param {number} [ms=5000] - 超时时间，默认5秒
 * @returns {Promise<T>}
 */
export async function withTimeout(promise, ms = 5000) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Firebase operation timed out')), ms);
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * 数据类型定义
 * @interface Data
 */
interface Data {
  [key: string]: any;
}

/**
 * Firebase错误扩展
 * @interface FirebaseError
 */
interface FirebaseError extends Error {
  code: string;
  message: string;
}

/**
 * 数据库读取操作
 * @param {string} path - 数据库路径
 * @param {{
 *   once?: boolean,
 *   timeout?: number
 * }} options
 * @returns {Promise<Data | null>}
 */
export async function read(
  path: string,
  {
    once = true,
    timeout = 5000
  }: {
    once?: boolean,
    timeout?: number
  } = {}
): Promise<Data | null> {
  try {
    const db = await initFirebase();
    const dbRef = ref(db, path);
    const result = await withTimeout(
      once ? get(dbRef) : dbRef.once('value'),
      timeout
    );
    const snapshot = result as any;
    return snapshot.val() || null;
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`❌ 数据库读取失败 (路径: ${path}):`, err.message);
      throw err;
    }
    throw new Error('Unknown error occurred during read operation');
  }
}

/**
 * 数据库写入操作
 * @param {string} path - 数据库路径
 * @param {Data} data - 待写入的数据
 * @param {{
 *   method?: 'set' | 'update' | 'push',
 *   timeout?: number
 * }} options
 * @returns {Promise<void>}
 */
export async function write(
  path: string,
  data: Data,
  {
    method = 'set',
    timeout = 5000
  }: {
    method?: 'set' | 'update' | 'push',
    timeout?: number
  } = {}
): Promise<void> {
  try {
    const db = await initFirebase();
    switch (method) {
      case 'set':
        await withTimeout(set(ref(db, path), data), timeout);
        break;
      case 'update':
        await withTimeout(update(ref(db, path), data), timeout);
        break;
      case 'push':
        await withTimeout(push(ref(db, path), data), timeout);
        break;
      default:
        throw new Error('Unsupported write method');
    }
    console.log(`✅ 数据成功写入路径: ${path}`);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`❌ 数据库写入失败 (路径: ${path}):`, err.message);
      throw err;
    }
    throw new Error('Unknown error occurred during write operation');
  }
}

/**
 * 数据库事务操作
 * @param {string} path - 数据库路径
 * @param {(currentValue: any) => any} updateFn - 更新函数
 * @param {{ timeout?: number }} options
 * @returns {Promise<void>}
 */
export async function transaction(
  path: string,
  updateFn: (currentValue: any) => any,
  {
    timeout = 5000
  }: {
    timeout?: number
  } = {}
): Promise<void> {
  try {
    const db = await initFirebase();
    await withTimeout(
      runTransaction(ref(db, path), (currentValue) => {
        return updateFn(currentValue || null);
      }),
      timeout
    );
    console.log(`✅ 事务操作完成: ${path}`);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`❌ 事务操作失败 (路径: ${path}):`, err.message);
      throw err;
    }
    throw new Error('Unknown error occurred during transaction');
  }
}

/**
 * 数据库删除操作
 * @param {string} path - 数据库路径
 * @param {{ timeout?: number }} options
 * @returns {Promise<void>}
 */
export async function del(
  path: string,
  {
    timeout = 5000
  }: {
    timeout?: number
  } = {}
): Promise<void> {
  try {
    const db = await initFirebase();
    await withTimeout(remove(ref(db, path)), timeout);
    console.log(`✅ 数据删除成功: ${path}`);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`❌ 数据删除失败 (路径: ${path}):`, err.message);
      throw err;
    }
    throw new Error('Unknown error occurred during delete operation');
  }
}

// 超时包装器
export async function withTimeout(promise, ms = CONFIG.TIMEOUT) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase操作超时')), ms));
  return Promise.race([promise, timeout]);
}

// 输入清理
export async function sanitizeInput(input) {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {}
  });
}

// 输入验证
export function validateInput(value, type) {
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
export async function parseBody(req) {
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
export async function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 计算总点赞数（统一实现）
export async function computeTotalLikes(postId, commentId, depth = 0, cache = new Map()) {
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

// 出口模块
export {
  initFirebase, read, write, del, transaction,
  computeTotalLikes,parseBody, setCORS, withTimeout, validateInput, CONFIG,
  sanitizeInput,  bcrypt
};

// 模块版本信息
export const VERSION = '1.2.0';
