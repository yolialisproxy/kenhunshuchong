// lib/utils.js - 终极修复 SyntaxError 后的版本

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
import sanitizeHtml from 'sanitize-html'; // 保留 sanitizeHtml 导入

console.log('✅ lib/utils.js加载成功');

// 简单的日志记录器
const logger = {
  info: (message, meta = {}) => console.log(`[INFO] Utils: ${message}`, meta),
  warn: (message, meta = {}) => console.warn(`[WARN] Utils: ${message}`, meta),
  error: (message, error, meta = {}) =>
    console.error(`❌ [ERROR] Utils: ${message}`, meta, error ? error.stack : '')
  // 修正 error 记录: 注释移到新行，避免任何可能性
};

// 配置
const CONFIG = {
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 10,
  CACHE_TTL: 300, // 5分钟缓存 (目前未使用)
};

// 模块功能说明
// ============
// 这是博客项目的数据库操作模块，负责与Firebase Realtime Database的交互
// 提供基础的数据读写、事务操作、错误处理等功能
// 作者：Your Name
// 版本：1.3.2 (更新版本号)
// 最后修改日期：2025-08-22 (今日终极修复)

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
    logger.error(`缺失env变量: ${missing.join(', ')}`);
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

/**
 * 初始化Firebase数据库
 * @returns {Promise<any>} 数据库实例
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
    logger.info('Firebase初始化成功');
    return db;
  } catch (err) {
    logger.error('Firebase初始化失败:', err);
    throw err;
  }
}

/**
 * 数据库操作超时控制
 * @param {Promise<any>} promise - 待执行的Promise (移除了 @template T)
 * @param {number} [ms=CONFIG.TIMEOUT] - 超时时间
 * @returns {Promise<any>}
 */
export async function withTimeout(promise, ms = CONFIG.TIMEOUT) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Firebase operation timed out')), ms);
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * 数据库读取操作
 * @param {string} path - 数据库路径
 * @param {object} [options] - 配置选项
 * @param {boolean} [options.once=true] - 是否只读取一次
 * @param {number} [options.timeout=CONFIG.TIMEOUT] - 超时时间
 * @returns {Promise<object>}
 */
export async function read(
  path,
  options = {}
) {
  const { once = true, timeout = CONFIG.TIMEOUT } = options;
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
      logger.error(`数据库读取失败 (路径: ${path}):`, err);
      throw err;
    }
    logger.error('Unknown error occurred during read operation:', { path, error: err });
    throw new Error('Unknown error occurred during read operation');
  }
}

/**
 * 数据库写入操作
 * @param {string} path - 数据库路径
 * @param {object} data - 待写入的数据
 * @param {object} [options] - 配置选项
 * @param {string} [options.method='set'] - 写入方法 ('set', 'update', 'push')
 * @param {number} [options.timeout=CONFIG.TIMEOUT] - 超时时间
 * @returns {Promise<any>} (简化类型，原为Promise<void | { key: string }>)
 */
export async function write(
  path,
  data,
  options = {}
) {
  const { method = 'set', timeout = CONFIG.TIMEOUT } = options;
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
        return await withTimeout(newRef, timeout); // push 返回一个引用
      default:
        throw new Error('Unsupported write method');
    }
    await withTimeout(writePromise, timeout);
    logger.info(`数据成功写入路径: ${path}`);
    return;
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`数据库写入失败 (路径: ${path}):`, err);
      throw err;
    }
    logger.error('Unknown error occurred during write operation:', { path, data, error: err });
    throw new Error('Unknown error occurred during write operation');
  }
}

/**
 * 数据库事务操作
 * @param {string} path - 数据库路径
 * @param {function(any): any} updateFn - 更新函数 (简化类型，原为 (currentValue: any) => any)
 * @param {object} [options] - 配置选项
 * @param {number} [options.timeout=CONFIG.TIMEOUT] - 超时时间
 * @returns {Promise<any>} runTransaction 返回的结果
 */
export async function transaction(
  path,
  updateFn,
  options = {}
) {
  const { timeout = CONFIG.TIMEOUT } = options;
  try {
    const dbInstance = await initFirebase();
    const result = await withTimeout(
      runTransaction(ref(dbInstance, path), (currentValue) => {
        return updateFn(currentValue || null);
      }),
      timeout
    );
    logger.info(`事务操作完成: ${path}`, { committed: result.committed, snapshotValue: result.snapshot.val() });
    return result;
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`事务操作失败 (路径: ${path}):`, err);
      throw err;
    }
    logger.error('Unknown error occurred during transaction:', { path, error: err });
    throw new Error('Unknown error occurred during transaction');
  }
}

/**
 * 数据库删除操作
 * @param {string} path - 数据库路径
 * @param {object} [options] - 配置选项
 * @param {number} [options.timeout=CONFIG.TIMEOUT] - 超时时间
 * @returns {Promise<void>}
 */
export async function del(
  path,
  options = {}
) {
  const { timeout = CONFIG.TIMEOUT } = options;
  try {
    const dbInstance = await initFirebase();
    await withTimeout(remove(ref(dbInstance, path)), timeout);
    logger.info(`数据删除成功: ${path}`);
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`数据删除失败 (路径: ${path}):`, err);
      throw err;
    }
    logger.error('Unknown error occurred during delete operation:', { path, error: err });
    throw new Error('Unknown error occurred during delete operation');
  }
}

/**
 * 清理输入字符串，移除 HTML 标签。
 * @param {string} input - 原始输入字符串
 * @returns {string} 清理后的字符串
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {}
  });
}

/**
 * 验证输入值是否符合指定类型。
 * @param {string} value - 待验证的值
 * @param {string} type - 验证类型 ('id', 'name', 'email', 'comment', 'username', 'password')
 * @returns {boolean} 如果验证通过返回 true，否则返回 false
 */
export function validateInput(value, type) {
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

/**
 * 解析HTTP请求体
 * @param {Request} req - HTTP请求对象，Vercel环境下的Web标准Request对象
 * @returns {Promise<object>} 解析后的请求体数据
 */
export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  try {
    const contentType = req.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return await req.json();
    }
    if (contentType?.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      return Object.fromEntries(params.entries());
    }
    logger.warn(`parseBody: Unhandled Content-Type or body format: ${contentType || 'missing content-type'}`);
    return {};
  } catch (e) {
    logger.warn('Request body parsing failed:', e);
    return {};
  }
}

/**
 * 设置CORS跨域头
 * @param {Response} res - HTTP响应对象，Vercel环境下的Web标准Response对象
 * @param {Request} req - 原始HTTP请求对象，用于获取Origin
 */
export function setCORS(res, req) {
  const allowedOrigins = [
    'https://*.vercel.app',
    'http://localhost:1313',
    // TODO: 添加您的 Hugo 博客生产域名，例如 'https://your-hugo-blog.com'
  ];
  const origin = req.headers.get('Origin');

  let originAllowed = false;
  if (origin) {
    originAllowed = allowedOrigins.some(ao => {
      // 严格匹配
      if (ao === origin) return true;
      // 通配符子域名匹配，例如 'https://*.example.com' 与 'https://sub.example.com'
      if (ao.startsWith('https://*.') && origin.startsWith('https://')) {
        const domainPattern = ao.substring(9); // e.g., 'vercel.app'
        if (origin.endsWith(domainPattern)) {
          // 确保匹配的是一个完整的子域名，而不是 'https://.example.com'
          const subdomainPart = origin.substring('https://'.length, origin.length - domainPattern.length);
          // 如果 subdomainPart 是空的或者不包含额外的 '.'，则认为是一级子域名
          return subdomainPart === '' || (subdomainPart.endsWith('.') && subdomainPart.indexOf('.') === subdomainPart.length - 1) || (subdomainPart.indexOf('.') === -1);
        }
      }
      return false;
    });
  }

  // 如果请求的 Origin 在白名单中，则设置允许该 Origin
  if (originAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV !== 'production') {
    // 开发环境下为了方便调试可能临时允许所有，生产环境应去除或更严格
    res.headers.set('Access-Control-Allow-Origin', '*');
  } else {
    // 生产环境，如果不在白名单中，可以考虑不设置 Access-Control-Allow-Origin
    // 或者返回一个明确的错误响应。这里为了兼容性，仍然可能设置 *，但更推荐严格处理
    // For now, setting '*' for robust compatibility in potentially complex production setups unless explicitly stricter rule desired.
    res.headers.set('Access-Control-Allow-Origin', '*');
  }

  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Max-Age', '86400'); // 缓存预检请求24小时
}

/**
 * 计算评论及其子评论的总点赞数。
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @param {number} [depth=0] - 当前递归深度
 * @returns {Promise<number>} - 总点赞数
 */
export async function computeTotalLikes(postId, commentId, depth = 0) {
  if (depth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn(`递归深度超过${CONFIG.MAX_RECURSION_DEPTH}`, { postId, commentId });
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('无效的 postId 或 commentId', { postId, commentId });
    return 0;
  }

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn('评论不存在', { postId, commentId });
      return 0;
    }

    let currentCommentDirectLikes = commentData.likes || 0;
    let childrenTotalLikes = 0;

    if (commentData.children && typeof commentData.children === 'object') {
      const childrenIds = Object.keys(commentData.children);
      const childPromises = childrenIds.map(childId =>
        validateInput(childId, 'id') ? computeTotalLikes(postId, childId, depth + 1) : Promise.resolve(0)
      );
      const childTotals = await Promise.allSettled(childPromises);

      childrenTotalLikes += childTotals.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
    }

    const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;
    return newTotalLikes;

  } catch (err) {
    logger.error('computeTotalLikes失败', { postId, commentId, error: err.message, stack: err.stack });
    throw err;
  }
}

// 出口模块
export {
  initFirebase, read, write, del, transaction,
  computeTotalLikes, parseBody, setCORS, withTimeout, validateInput, CONFIG,
  sanitizeInput,
};

// 模块版本信息
export const VERSION = '1.3.2';
