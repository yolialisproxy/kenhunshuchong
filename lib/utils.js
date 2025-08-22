// lib/utils.js - 终极修复 SyntaxError 后的最最最保守版本

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

console.log('✅ lib/utils.js加载成功');

// 简单日志记录器 (更简洁的声明方式)
const logger = {
  info: function(message, meta) { console.log('[INFO] Utils>', message, meta || ''); },
  warn: function(message, meta) { console.warn('[WARN] Utils>', message, meta || ''); },
  error: function(message, error, meta) {
    console.error('[ERROR] Utils>', message, meta || '', error ? error.stack : '');
  }
};

// 配置
const CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 10,
  CACHE_TTL: 300,
};

// 模块功能说明
// ============
// 这是博客项目的数据库操作模块，负责与Firebase Realtime Database的交互
// 提供基础的数据读写、事务操作、错误处理等功能
// 作者：Your Name
// 版本：1.3.3 (再次更新版本号)
// 最后修改日期：2025-08-22 (今日超超守修正)

// 初始化 Firebase 应用
let app, db;

// 验证环境变量
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
export async function withTimeout(promise, ms) { // 移除 ms = CONFIG.TIMEOUT 的默认值，改为函数体内部设置
  const timeoutMs = ms || CONFIG.TIMEOUT; // 在函数体内部设置默认值
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Firebase operation timed out')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

// 数据库读取操作
export async function read(path, options) { // 移除对 options = {} 的默认值
  const opts = options || {}; // 在函数体内部设置默认值
  const once = opts.once === undefined ? true : opts.once;
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    const dbRef = ref(dbInstance, path);
    const result = await withTimeout(
      once ? get(dbRef) : dbRef.once('value'),
      timeout
    );
    const snapshot = result;
    return snapshot.val() || null;
  } catch (err) {
    if (err instanceof Error) {
      logger.error('数据库读取失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error occurred during read operation:', { path: path, error: err });
    throw new Error('Unknown error occurred during read operation');
  }
}

// 数据库写入操作
export async function write(path, data, options) { // 移除对 options = {} 的默认值
  const opts = options || {}; // 在函数体内部设置默认值
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
        const newRef = push(ref(dbInstance, path), data);
        return await withTimeout(newRef, timeout);
      default:
        throw new Error('Unsupported write method');
    }
    await withTimeout(writePromise, timeout);
    logger.info('数据成功写入路径: ' + path);
    return;
  } catch (err) {
    if (err instanceof Error) {
      logger.error('数据库写入失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error occurred during write operation:', { path: path, data: data, error: err });
    throw new Error('Unknown error occurred during write operation');
  }
}

// 数据库事务操作
export async function transaction(path, updateFn, options) { // 移除对 options = {} 的默认值
  const opts = options || {}; // 在函数体内部设置默认值
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    const result = await withTimeout(
      runTransaction(ref(dbInstance, path), function(currentValue) { // 匿名函数使用 function 关键字
        return updateFn(currentValue || null);
      }),
      timeout
    );
    logger.info('事务操作完成: ' + path, { committed: result.committed, snapshotValue: result.snapshot.val() });
    return result;
  } catch (err) {
    if (err instanceof Error) {
      logger.error('事务操作失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error occurred during transaction:', { path: path, error: err });
    throw new Error('Unknown error occurred during transaction');
  }
}

// 数据库删除操作
export async function del(path, options) { // 移除对 options = {} 的默认值
  const opts = options || {}; // 在函数体内部设置默认值
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    await withTimeout(remove(ref(dbInstance, path)), timeout);
    logger.info('数据删除成功: ' + path);
  } catch (err) {
    if (err instanceof Error) {
      logger.error('数据删除失败 (路径: ' + path + '):', err);
      throw err;
    }
    logger.error('Unknown error occurred during delete operation:', { path: path, error: err });
    throw new Error('Unknown error occurred during delete operation');
  }
}

// 清理输入字符串，移除 HTML 标签。
export function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {}
  });
}

// 验证输入值是否符合指定类型。
export async function validateInput(value, type) {
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
    logger.warn('parseBody: Unhandled Content-Type or body format: ' + (contentType || 'missing content-type'));
    return {};
  } catch (e) {
    logger.warn('Request body parsing failed:', e);
    return {};
  }
}

// 设置CORS跨域头
export async function setCORS(res, req) {
  const allowedOrigins = [
    'https://*.vercel.app',
    'http://localhost:1313',
    // TODO: 添加您的 Hugo 博客生产域名，例如 'https://your-hugo-blog.com'
  ];
  const origin = req.headers.get('Origin');

  let originAllowed = false;
  if (origin) {
    originAllowed = allowedOrigins.some(ao => {
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

  if (originAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV !== 'production') {
    res.headers.set('Access-Control-Allow-Origin', '*');
  } else {
    res.headers.set('Access-Control-Allow-Origin', '*');
  }

  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Max-Age', '86400');
}

// 计算评论及其子评论的总点赞数。
export async function computeTotalLikes(postId, commentId, depth) { // 移除 depth = 0 的默认值
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
      const childPromises = childrenIds.map(function(childId) { // 匿名函数使用 function 关键字
        return validateInput(childId, 'id') ? computeTotalLikes(postId, childId, currentDepth + 1) : Promise.resolve(0);
      });
      const childTotals = await Promise.allSettled(childPromises);

      childrenTotalLikes += childTotals.reduce(function(sum, result) { // 匿名函数使用 function 关键字
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

// 模块出口
export {
  initFirebase, read, write, del, transaction,
  computeTotalLikes, parseBody, setCORS, withTimeout, validateInput, CONFIG,
  sanitizeInput, logger
};

// 模块版本信息
export const VERSION = '1.3.3';
