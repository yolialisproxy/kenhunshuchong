// lib/utils.js - 核心工具函数 (修正版)
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, remove, runTransaction } from 'firebase/database';
import { URL } from 'url'; // For parsing URLs in parseBody

// ==================== 全局配置 ====================
// NOTE: Firebase 配置应从环境变量中获取，以确保安全和灵活性
const FIREBASE_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

const CONFIG = {
  MAX_RETRIES: 3, // API 调用最大重试次数
  RETRY_INTERVAL_BASE: 1000, // 基础重试间隔（毫秒）
  TIMEOUT: 8000, // 数据库操作超时时间（毫秒）
  ADMIN_USERNAME: "yolialisproxy", // 管理员用户名，用于后端权限判断
  COMMENT_VALIDATION: { // 评论验证配置 (与前端保持一致)
      name: { min: 1, max: 50 },
      username: { min: 1, max: 50 },
      email: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      comment: { min: 1, max: 500 },
      password: { min: 8, max: 100, requireLower: true, requireUpper: true, requireDigit: true },
      id: { regex: /^[a-zA-Z0-9_-]+$/, min: 1, max: 100 }
  }
};

// --- Logger ---
const levels = { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', SUCCESS: 'SUCCESS' };
const colors = { DEBUG: 'color: gray;', INFO: 'color: blue;', WARN: 'color: orange;', ERROR: 'color: red; font-weight: bold;', SUCCESS: 'color: green; font-weight: bold;' };
const prefix = '[Utils]';

export const logger = {
    log: (level, message, context) => {
        const timestamp = new Date().toLocaleString();
        const levelPrefix = `[${level}]`.padEnd(10);
        let output = `${timestamp} ${levelPrefix}${message}`;
        if (context) {
            try {
                output += ` ${JSON.stringify(context)}`;
            } catch (e) {
                output += ` [Context Stringification Error: ${e.message}]`;
            }
        }
        // In Node.js environment, console.log doesn't support CSS colors directly.
        // We'll just output the plain text.
        console.log(output);
    },
    debug: (message, context) => logger.log(levels.DEBUG, message, context),
    info: (message, context) => logger.log(levels.INFO, message, context),
    warn: (message, context) => logger.log(levels.WARN, message, context),
    error: (message, context) => logger.log(levels.ERROR, message, context),
    success: (message, context) => logger.log(levels.SUCCESS, message, context),
};
logger.info('✅ lib/utils.js 加载成功');

// --- Firebase Initialization ---
let app;
let db;

export function initFirebase() {
  if (!app) {
    try {
      app = initializeApp(FIREBASE_CONFIG);
      db = getDatabase(app);
      logger.info('Firebase 应用初始化成功');
    } catch (error) {
      logger.error('Firebase 应用初始化失败', error);
      throw new Error('Firebase initialization failed.');
    }
  }
  return db;
}

// --- Custom Error Class for Validation ---
export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

// --- Input Validation (Backend) ---
export function validateInput(value, type) {
    if (typeof value !== 'string') {
        logger.warn(`[Backend Validation] Value is not a string for type: ${type}`, { value });
        return false;
    }

    const config = CONFIG.COMMENT_VALIDATION[type];
    if (!config) {
        logger.warn(`[Backend Validation] Unknown validation type: ${type}`);
        return false;
    }

    let isValid = true;

    if (config.min && value.length < config.min) isValid = false;
    if (config.max && value.length > config.max) isValid = false;
    if (config.regex && !config.regex.test(value)) isValid = false;

    if (type === 'password') {
        if (config.requireLower && !/[a-z]/.test(value)) isValid = false;
        if (config.requireUpper && !/[A-Z]/.test(value)) isValid = false;
        if (config.requireDigit && !/\d/.test(value)) isValid = false;
    }

    if (!isValid) {
        logger.debug(`[Backend Validation] Validation failed for type: ${type}, value: ${value}`);
    }
    return isValid;
}

// --- Input Sanitization (Backend) ---
// For backend, we generally trust the data after validation,
// but can add basic trimming. HTML escaping should be done on the frontend.
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.trim();
}

// --- Database Operations with Retry Logic ---
async function executeDbOperation(operation, path, options = {}) {
  const maxRetries = options.maxRetries || CONFIG.MAX_RETRIES;
  const retryIntervalBase = options.retryIntervalBase || CONFIG.RETRY_INTERVAL_BASE;
  const timeout = options.timeout || CONFIG.TIMEOUT;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const dbRef = ref(db, path);
      const result = await Promise.race([
        operation(dbRef, options.data),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database operation timed out')), timeout))
      ]);
      return result;
    } catch (error) {
      logger.error(`[DB] 操作失败 (路径: ${path}, 尝试 ${i + 1}/${maxRetries + 1}):`, error);
      if (i < maxRetries) {
        const delay = retryIntervalBase * Math.pow(2, i);
        logger.warn(`[DB] 重试中，等待 ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error; // Re-throw after all retries
      }
    }
  }
}

export async function read(path, options = {}) {
  return executeDbOperation(async (dbRef) => {
    const snapshot = await get(dbRef);
    return snapshot.val();
  }, path, options);
}

export async function write(path, data, options = {}) {
  const method = options.method || 'set'; // 'set', 'update', 'push'
  return executeDbOperation(async (dbRef) => {
    if (method === 'set') {
      return set(dbRef, data);
    } else if (method === 'update') {
      return update(dbRef, data);
    } else if (method === 'push') {
      // For push, data is usually null or the initial value for the new child
      return set(dbRef, data); // Firebase push returns a new ref, then you set data on it.
                               // Here, we simulate push by getting a new ref key and setting data.
      // A more direct push:
      // const newRef = push(dbRef);
      // await set(newRef, data);
      // return newRef;
    }
    throw new Error(`Unsupported write method: ${method}`);
  }, path, options);
}

export async function del(path, options = {}) {
  return executeDbOperation(async (dbRef) => {
    return remove(dbRef);
  }, path, options);
}

export async function transaction(path, updateFunction, options = {}) {
  return executeDbOperation(async (dbRef) => {
    return runTransaction(dbRef, updateFunction);
  }, path, options);
}

// --- Request Body Parser for Vercel ---
export async function parseBody(req) {
  // 1. 优先检查 Vercel 是否已预解析请求体。
  // 对于 Content-Type: application/json 的 POST 请求，Vercel 通常会将其解析为对象并放在 req.body 上。
  if (req.body && typeof req.body === 'object') {
    logger.debug('[Utils] parseBody: Vercel 预解析的请求体已找到并使用。', req.body);
    return req.body;
  }

  // 2. 对于 GET 或 HEAD 请求，请求体通常在 URL 查询参数中。
  if (req.method === 'GET' || req.method === 'HEAD') {
    // FIX: 优先使用 Vercel 提供的 req.query 对象，它已经解析了 URL 参数
    if (req.query && typeof req.query === 'object' && Object.keys(req.query).length > 0) {
        logger.debug('[Utils] parseBody: GET/HEAD 请求，使用 req.query。', req.query);
        return req.query;
    }

    // Fallback: 如果 req.query 不存在或为空，则手动解析 URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryParams = {};
    for (const [key, value] of url.searchParams.entries()) {
      queryParams[key] = value;
    }
    logger.debug('[Utils] parseBody: GET/HEAD 请求，手动解析 URL 查询参数。', queryParams);
    return queryParams;
  }

  // 3. 对于 POST/PUT/DELETE 等请求，如果 req.body 未被预解析为对象，则从请求流中读取。
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString(); // 将 Buffer 转换为字符串
    });
    req.on('end', () => {
      if (!body) {
        logger.warn('[Utils] parseBody: 请求流结束，但未接收到任何请求体数据。');
        return resolve({}); // 没有请求体数据，返回空对象
      }
      try {
        // 尝试将请求体解析为 JSON (前端通常发送 application/json)
        const parsed = JSON.parse(body);
        logger.debug('[Utils] parseBody: 从请求流中成功解析 JSON 请求体。', parsed);
        resolve(parsed);
      } catch (e) {
        // 如果不是 JSON，尝试解析为 URL-encoded 格式 (作为备用方案)
        try {
          const urlParams = new URLSearchParams(body);
          const parsed = {};
          for (const [key, value] of urlParams.entries()) {
            parsed[key] = value;
          }
          logger.debug('[Utils] parseBody: 从请求流中成功解析 URL-encoded 请求体。', parsed);
          resolve(parsed);
        } catch (e2) {
          logger.error('[Utils] parseBody: 无法从请求流中解析请求体 (非 JSON 也非 URL-encoded)。', { error1: e.message, error2: e2.message, rawBody: body });
          reject(new Error('Failed to parse request body from stream.'));
        }
      }
    });
    req.on('error', err => {
      logger.error('[Utils] parseBody: 读取请求流时发生错误。', err);
      reject(err);
    });
  });
}

// --- CORS Headers Setter ---
export function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins for development
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
}

/**
* 递归计算评论及其所有子评论的总点赞数。
* @param {string} postId - 文章ID
* @param {string} commentId - 评论ID
* @returns {Promise<number>} - 计算出的总点赞数
*/
export async function computeTotalLikes(postId, commentId) {
  if (!postId || !commentId) {
    logger.error(`[Utils] computeTotalLikes: 缺少 postId 或 commentId (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn(`[Utils] computeTotalLikes: 评论不存在，无法计算总赞数 (postId: ${postId}, commentId: ${commentId})`);
      return 0;
    }

    let directLikes = commentData.likes || 0;
    let childrenTotalLikes = 0;

    // Recursively sum children's total likes
    if (commentData.children && typeof commentData.children === 'object') {
      for (const childId of Object.keys(commentData.children)) {
        // Ensure childId is valid before recursive call
        if (validateInput(childId, 'id')) {
          childrenTotalLikes += await computeTotalLikes(postId, childId);
        } else {
          logger.warn(`[Utils] computeTotalLikes: 发现无效子评论ID，已跳过 (postId: ${postId}, parentId: ${commentId}, childId: ${childId})`);
        }
      }
    }

    const newTotalLikes = directLikes + childrenTotalLikes;
    logger.debug(`[Utils] computeTotalLikes: 计算评论总赞数 (commentId: ${commentId}, direct: ${directLikes}, childrenTotal: ${childrenTotalLikes}, total: ${newTotalLikes})`);
    return newTotalLikes;

  } catch (error) {
    logger.error(`[Utils] computeTotalLikes: 计算评论总赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to compute total likes for comment tree.');
  }
}

export { CONFIG }; // Export CONFIG for other modules
