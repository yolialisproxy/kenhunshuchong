// lib/utils.js - 终极修复版：同步validateInput，优化sanitizeInput，Vercel兼容CORS

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
  console.log(`✅ [Utils] ${message}`, context || ''); // 修正为 console.log
}

// 导出日志记录器
export const logger = { // 修正为直接导出
  info: logInfo,
  warn: logWarn,
  error: logError,
  success: logSuccess
};

// 配置
export const CONFIG = { // 修正为直接导出
  MAX_RETRIES: 3,
  RETRY_INTERVAL_BASE: 1000, // 新增：重试基础间隔
  TIMEOUT: 5000, // 数据库操作超时时间
  MAX_RECURSION_DEPTH: 20, // 评论总赞数计算的最大递归深度
  CACHE_TTL: 300, // 内存缓存时间 (秒)
};

// 简单内存缓存 (Vercel Serverless 友好) - 注意：Vercel 冷启动可能导致缓存失效
const cache = new Map();
export function getCache(key) { // 修正为同步函数
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CONFIG.CACHE_TTL * 1000) {
    logger.info('从缓存命中', { key });
    return entry.value;
  }
  cache.delete(key);
  logger.info('缓存未命中或过期', { key });
  return null;
}
function setCache(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
  logger.info('已设置缓存', { key });
}
function invalidateCache(keyPrefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) {
      cache.delete(key);
      logger.info('已失效缓存', { key });
    }
  }
}


// 初始化 Firebase 应用
let app, db;

// 验证环境变量
export function validateEnv() { // 修正为同步函数
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
  if (db) {
    logger.info('Firebase已初始化，直接返回db实例');
    return db;
  }
  try {
    validateEnv(); // 确保环境变量已验证
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
    logger.success('Firebase初始化成功');
    return db;
  } catch (err) {
    logger.error('Firebase初始化失败:', err);
    throw err;
  }
}

// 数据库操作超时控制
// 注意：此函数不应直接在业务模块中调用，而是封装在 read/write/transaction/del 内部
function withTimeout(promise, ms) {
  const timeoutMs = ms || CONFIG.TIMEOUT;
  const timeoutPromise = new Promise(function(_, reject) {
    const id = setTimeout(function() {
      clearTimeout(id); // 清除自身的定时器
      reject(new Error(`Firebase operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

// 数据库读取操作 (添加缓存)
export async function read(path, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  const cacheKey = 'read:' + path; // 简化缓存key

  const cached = getCache(cacheKey);
  if (cached !== null) { // 检查是否为 null，因为值可能是 0 或 false
    logger.info('从缓存读取: ' + path);
    return cached;
  }

  try {
    const dbInstance = await initFirebase();
    const dbRef = ref(dbInstance, path);
    const snapshot = await withTimeout(get(dbRef), timeout); // 始终使用 get(dbRef)
    const value = snapshot.val() || null;
    setCache(cacheKey, value);
    logger.info('数据库读取成功 (路径: ' + path + ')');
    return value;
  } catch (err) {
    logger.error('数据库读取失败 (路径: ' + path + '):', err);
    throw err;
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
    let newRef = null;

    switch (method) {
      case 'set':
        writePromise = set(ref(dbInstance, path), data);
        break;
      case 'update':
        writePromise = update(ref(dbInstance, path), data);
        break;
      case 'push':
        newRef = push(ref(dbInstance, path));
        writePromise = set(newRef, data);
        break;
      default:
        throw new Error('Unsupported write method: ' + method);
    }
    await withTimeout(writePromise, timeout);
    logger.info('数据成功写入路径: ' + path, { method, data: newRef ? null : data });
    // 写入后失效相关缓存
    invalidateCache('read:' + path.split('/').slice(0, 2).join('/')); // 失效父路径及自身缓存

    if (method === 'push' && newRef) {
      return { key: newRef.key }; // 统一返回 { key }
    }
    return;
  } catch (err) {
    logger.error('数据库写入失败 (路径: ' + path + '):', err);
    throw err;
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
    invalidateCache('read:' + path);
    return result;
  } catch (err) {
    logger.error('事务操作失败 (路径: ' + path + '):', err);
    throw err;
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
    invalidateCache('read:' + path.split('/').slice(0, 2).join('/')); // 失效父路径及自身缓存
  } catch (err) {
    logger.error('数据删除失败 (路径: ' + path + '):', err);
    throw err;
  }
}

// 清理输入字符串：移除HTML标签和特殊危险字符，保留合法字符
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    logger.warn('sanitizeInput: 输入不是字符串', { input });
    return '';
  }
  try {
    const sanitized = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // 移除 script 标签
      .replace(/<[^>]+>/g, '') // 移除所有其他 HTML 标签
      // 修正：将连字符 '-' 移动到字符类的末尾，使其被解析为字面量字符
      .replace(/[^\p{L}\p{N}\s._@\-]/gu, '') // 移除除字母、数字、空格、. _ @ - 之外的所有字符（支持Unicode）
      .trim(); // 去除首尾空格
    logger.info('sanitizeInput 成功', { original: input.slice(0, 50), sanitized: sanitized.slice(0, 50) });
    return sanitized;
  } catch (error) {
    logger.error('sanitizeInput 失败', error, { input });
    return '';
  }
}

// 验证输入值 (同步函数，且不再对 password 进行 sanitizeInput)
export function validateInput(value, type) {
  if (typeof value !== 'string') {
      logger.warn(`validateInput: 值不是字符串 (type: ${type})`, { value });
      return false;
  }
  // 对于密码和其他需要保留精确字符的类型，不进行 sanitizeInput
  const processedValue = (type === 'password' || type === 'email' || type === 'id' || type === 'username') ? value : sanitizeInput(value);

  switch (type) {
    case 'id': // Firebase ID, 允许字母数字下划线连字符
      return /^[a-zA-Z0-9_-]+$/.test(processedValue) && processedValue.length >= 1;
    case 'name': // 用户名或评论者姓名，通用文本
      return processedValue.length >= 2 && processedValue.length <= 50;
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(processedValue); // 邮件格式验证
    case 'comment':
      return processedValue.length >= 5 && processedValue.length <= 500;
    case 'username': // 严格的用户名格式（通常用于登录名）
      return /^[a-zA-Z0-9_-]{3,20}$/.test(processedValue);
    case 'password': // 密码，要求强度
      return processedValue.length >= 8 && processedValue.length <= 100 &&
             /[a-z]/.test(processedValue) && /[A-Z]/.test(processedValue) && /\d/.test(processedValue);
    default:
      logger.warn(`validateInput: 未知验证类型 (type: ${type})`);
      return false;
  }
}

// 解析HTTP请求体 (Vercel Edge Runtime 兼容)
export async function parseBody(req) {
  // 如果 req.body 直接是对象 (例如 Nextjs api路由的处理或模拟环境)
  if (req.body && typeof req.body === 'object' && !('pipeTo' in req.body)) { // Check for ReadableStream presence
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
    logger.warn('parseBody: 未处理的 Content-Type: ' + (contentType || '缺失'));
    return {};
  } catch (e) {
    logger.error('parseBody: 请求体解析失败:', e);
    return {};
  }
}

// 设置CORS跨域头 (Vercel Edge Runtime 兼容，返回 Headers 对象)
// 这个函数现在返回一个包含 CORS 头部键值对的对象，调用方需要自行合并到 Response
export function setCORS(req) { // 不再需要 res 参数
  // 生产环境白名单，通常由环境变量管理
  const productionAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'https://*.vercel.app,https://*.kenhunshuchong.web.app').split(',');
  const wildcardDomains = productionAllowedOrigins.filter(o => o.includes('*'));

  const origin = req.headers && req.headers.get('origin') ? req.headers.get('origin').toLowerCase() : '';

  let originAllowed = false;
  if (origin) {
    originAllowed = productionAllowedOrigins.includes(origin); // 精确匹配
    if (!originAllowed) { // 尝试通配符匹配
      for (const wildcard of wildcardDomains) {
        // 将通配符 * 转换为正则表达式 .*
        const regex = new RegExp(`^${wildcard.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
        if (regex.test(origin)) {
          originAllowed = true;
          break;
        }
      }
    }
  }

  const allowOrigin = originAllowed ? origin : (process.env.NODE_ENV !== 'production' ? origin || '*' : 'null'); // 生产环境默认不允许未知来源

  const headers = {};
  if (allowOrigin !== 'null') { // 如果 origin 被明确允许或在开发模式下
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  } else {
    // 明确设置不允许，阻止浏览器发送凭据
    headers['Access-Control-Allow-Origin'] = 'null';
  }

  headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  headers['Access-Control-Max-Age'] = '86400'; // 缓存预检结果24小时

  logger.info('CORS headers generated', { origin, originAllowed, allowOrigin });
  return headers;
}

// 计算评论总点赞数 (优化深度，纯计算，不涉及数据库写入)
export async function computeTotalLikes(postId, commentId, startDepth = 0) {
  const currentDepth = startDepth;
  if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn('computeTotalLikes: 递归深度超过最大限制，停止计算', { postId, commentId, currentDepth });
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('computeTotalLikes: 无效的 postId 或 commentId', { postId, commentId });
    return 0;
  }

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn('computeTotalLikes: 评论不存在，无法计算点赞数', { postId, commentId });
      return 0;
    }

    let currentCommentDirectLikes = typeof commentData.likes === 'number' ? commentData.likes : 0;
    let childrenTotalLikes = 0;

    if (commentData.children && typeof commentData.children === 'object') {
      const childrenIds = Object.keys(commentData.children);
      const childPromises = childrenIds.map(function(childId) {
        // 对子评论 ID 再次验证
        return validateInput(childId, 'id') ? computeTotalLikes(postId, childId, currentDepth + 1) : Promise.resolve(0);
      });
      const childTotals = await Promise.allSettled(childPromises);

      childrenTotalLikes += childTotals.reduce(function(sum, result) {
        return sum + (result.status === 'fulfilled' ? result.value : 0);
      }, 0);
    }

    const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;
    logger.info('computeTotalLikes: 成功计算评论总点赞数', { postId, commentId, totalLikes: newTotalLikes, depth: currentDepth });
    return newTotalLikes;

  } catch (err) {
    logger.error('computeTotalLikes: 计算失败', { postId, commentId, error: err.message, stack: err.stack });
    throw err;
  }
}

// 模块版本信息
export const VERSION = '1.5.0'; // 升级版本
