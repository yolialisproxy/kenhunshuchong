// lib/utils.js - 终极优化版：添加内存缓存，统一JS风格

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

console.log('✅ lib/utils.js加载成功');

// 自定义 ValidationError 类
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// 日志函数定义
function logInfo(message, context) {
  console.log(`ℹ️ [Utils] ${message}`, context || '');
}
function logWarn(message, context) {
  console.warn(`⚠️ [Utils] ${message}`, context || '');
}
function logError(message, error, context) {
  console.error(`❌ [Utils] ${message}`, context || '', error ? error.stack : '');
}
function logSuccess(message, context) {
  console.warn(`✅ [Utils] ${message}`, context || '');
}

// 简单日志记录器
const logger = {
  info: logInfo,
  warn: logWarn,
  error: logError,
  success: LogSuccess
};

// 配置
const CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 20, // 优化：降低深度限制防栈溢出
  CACHE_TTL: 300,
};

// 简单内存缓存 (Vercel Serverless友好)
const cache = new Map();
export async function getCache(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CONFIG.CACHE_TTL * 1000) {
    return entry.value;
  }
  cache.delete(key);
  return null;
}
function setCache(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}

// 初始化 Firebase 应用
let app, db;

// 验证环境变量
export async function validateEnv() {
  const required = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
  ];
  const missing = required.filter(function(key) { return !process.env[key]; });
  if (missing.length) {
    logger.error('缺失env变量: ' + missing.join(', '));
    throw new Error('Missing environment variables: ' + missing.join(', '));
  }
}

// 初始化Firebase数据库
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
    logger.info('Firebase初始化成功');
    return db;
  } catch (err) {
    logger.error('Firebase初始化失败:', err);
    throw err;
  }
}

// 数据库操作超时控制
export async function withTimeout(promise, ms) {
  const timeoutMs = ms || CONFIG.TIMEOUT;
  const timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('Firebase operation timed out')); }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

// 数据库读取操作 (添加缓存)
export async function read(path, options) {
  const opts = options || {};
  const once = opts.once === undefined ? true : opts.once;
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  const cacheKey = 'read:' + path + ':' + once;

  const cached = getCache(cacheKey);
  if (cached) {
    logger.info('从缓存读取: ' + path);
    return cached;
  }

  try {
    const dbInstance = await initFirebase();
    const dbRef = ref(dbInstance, path);
    const result = await withTimeout(
      once ? get(dbRef) : dbRef.once('value'),
      timeout
    );
    const snapshot = result;
    const value = snapshot.val() || null;
    setCache(cacheKey, value);
    return value;
  } catch (err) {
    if (err instanceof Error) {
      logger.error('数据库读取失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error during read:', { path: path, error: err });
    throw new Error('Unknown error during read');
  }
}

// 数据库写入操作
export async function write(path, data, options) {
  const opts = options || {};
  const method = opts.method || 'set';
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    let writePromise;
    switch (method) {
      case 'set':
        writePromise = set(ref(dbInstance, path), data);
        break;
      case 'update':
        writePromise = update(ref(dbInstance, path), data);
        break;
      case 'push':
        const newRef = push(ref(dbInstance, path));
        await set(newRef, data);
        return { key: newRef.key }; // 统一返回 { key }
      default:
        throw new Error('Unsupported write method');
    }
    await withTimeout(writePromise, timeout);
    logger.info('数据成功写入路径: ' + path);
    // 写入后失效相关缓存
    cache.delete('read:' + path);
    return;
  } catch (err) {
    if (err instanceof Error) {
      logger.error('数据库写入失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error during write:', { path: path, data: data, error: err });
    throw new Error('Unknown error during write');
  }
}

// 数据库事务操作
export async function transaction(path, updateFn, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    const result = await withTimeout(
      runTransaction(ref(dbInstance, path), function(currentValue) {
        return updateFn(currentValue || null);
      }),
      timeout
    );
    logger.info('事务操作完成: ' + path, { committed: result.committed, snapshotValue: result.snapshot.val() });
    // 事务后失效缓存
    cache.delete('read:' + path);
    return result;
  } catch (err) {
    if (err instanceof Error) {
      logger.error('事务操作失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error during transaction:', { path: path, error: err });
    throw new Error('Unknown error during transaction');
  }
}

// 数据库删除操作
export async function del(path, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    await withTimeout(remove(ref(dbInstance, path)), timeout);
    logger.info('数据删除成功: ' + path);
    cache.delete('read:' + path);
  } catch (err) {
    if (err instanceof Error) {
      logger.error('数据删除失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error during delete:', { path: path, error: err });
    throw new Error('Unknown error during delete');
  }
}

// 清理输入字符串（替换 sanitize-html）
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    logger.warn('sanitizeInput: 输入不是字符串', { input });
    return '';
  }
  try {
    // 移除 HTML 标签、脚本和危险字符
    const sanitized = input
      .replace(/<[^>]+>/g, '') // 移除所有 HTML 标签
      .replace(/[\n\r\t]+/g, ' ') // 替换换行、制表符为空格
      .replace(/[<>{}\[\]\(\)\'\"\\\/]/g, '') // 移除潜在危险字符
      .trim(); // 去除首尾空格
    logger.info('sanitizeInput 成功', { input: input.slice(0, 50), output: sanitized.slice(0, 50) });
    return sanitized;
  } catch (error) {
    logger.error('sanitizeInput 失败', error, { input });
    return '';
  }
}

// 验证输入值
export function validateInput(value, type) { // 同步化，移除async
  const sanitized = sanitizeInput(value);
  switch (type) {
    case 'id':
      return /^[a-zA-Z0-9_-]+$/.test(sanitized);
    case 'name':
      return sanitized.length >= 2 && sanitized.length <= 50;
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized);
    case 'comment':
      return sanitized.length >= 5 && sanitized.length <= 500;
    case 'username':
      return /^[a-zA-Z0-9_-]{3,20}$/.test(sanitized);
    case 'password':
      return sanitized.length >= 8 && sanitized.length <= 100 && /[a-z]/.test(sanitized) && /[A-Z]/.test(sanitized) && /\d/.test(sanitized);
    default:
      return false;
  }
}

// 解析HTTP请求体
export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  try {
    const contentType = req.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await req.json();
    }
    if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      return Object.fromEntries(params.entries());
    }
    logger.warn('parseBody: Unhandled Content-Type: ' + (contentType || 'missing'));
    return {};
  } catch (e) {
    logger.warn('Request body parsing failed:', e);
    return {};
  }
}

// 设置CORS跨域头（兼容 Vercel 的 http.ServerResponse）
export function setCORS(res, req) {
  const allowedOrigins = [
    'https://*.vercel.app',
    'http://localhost:1313',
  ];

  // 使用 req.headers.origin 提取 Origin
  const origin = req.headers && req.headers.origin ? req.headers.origin.toLowerCase() : '';

  // 检查 res 是否有效且支持 setHeader
  if (!res || typeof res.setHeader !== 'function') {
    logger.warn('setCORS: Invalid res object, skipping headers setup', { res: !!res, setHeader: !!res?.setHeader });
    return;
  }

  let originAllowed = false;
  if (origin) {
    originAllowed = allowedOrigins.some(function(ao) {
      if (ao === origin) return true;
      if (ao.startsWith('https://*.') && origin.startsWith('https://')) {
        const domainPattern = ao.substring(9);
        if (origin.endsWith(domainPattern)) {
          const subdomainPart = origin.substring('https://'.length, origin.length - domainPattern.length);
          return subdomainPart === '' || (subdomainPart.endsWith('.') && subdomainPart.indexOf('.') === subdomainPart.length - 1) || (subdomainPart.indexOf('.') === -1);
        }
      }
      return false;
    });
  }

  // 使用 res.setHeader 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', originAllowed || process.env.NODE_ENV !== 'production' ? origin || '*' : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  logger.info('CORS headers set', { origin, originAllowed });
}

// 计算评论总点赞数 (优化深度)
export async function computeTotalLikes(postId, commentId, depth) {
  const currentDepth = depth || 0;
  if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn('递归深度超过' + CONFIG.MAX_RECURSION_DEPTH, { postId: postId, commentId: commentId });
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('无效的 postId 或 commentId', { postId: postId, commentId: commentId });
    return 0;
  }

  const commentPath = 'comments/' + postId + '/' + commentId;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn('评论不存在', { postId: postId, commentId: commentId });
      return 0;
    }

    let currentCommentDirectLikes = commentData.likes || 0;
    let childrenTotalLikes = 0;

    if (commentData.children && typeof commentData.children === 'object') {
      const childrenIds = Object.keys(commentData.children);
      const childPromises = childrenIds.map(function(childId) {
        return validateInput(childId, 'id') ? computeTotalLikes(postId, childId, currentDepth + 1) : Promise.resolve(0);
      });
      const childTotals = await Promise.allSettled(childPromises);

      childrenTotalLikes += childTotals.reduce(function(sum, result) {
        return sum + (result.status === 'fulfilled' ? result.value : 0);
      }, 0);
    }

    const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;
    return newTotalLikes;

  } catch (err) {
    logger.error('computeTotalLikes失败', { postId: postId, commentId: commentId, error: err.message, stack: err.stack });
    throw err;
  }
}

export { logger }

// 模块版本信息
export const VERSION = '1.4.0'; // 升级版本
