// lib/utils.js - 最终、最终、最终、最终修复版：评论最小长度改为1，兼容性至上
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

// --- 自定义错误 ---
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// --- 日志 ---
function logInfo(message, context) { console.log`ℹ️ [Utils] ${message}`, context || ''); }
function logWarn(message, context) { console.warn`⚠️ [Utils] ${message}`, context || ''); }
function logError(message, error, context) { console.error`❌ [Utils] ${message}`, context || '', error ? error.stack : ''); }
function logSuccess(message, context) { console.log`✅ [Utils] ${message}`, context || ''); }
export const logger = { info: logInfo, warn: logWarn, error: logError, success: logSuccess };

// --- 配置 ---
export const CONFIG = {
  MAX_RETRIES: 3,
  RETRY_INTERVAL_BASE: 1000,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 20,
  CACHE_TTL: 300,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  COMMENT_VALIDATION: {
      // name 和 username 规则统一为 1-50 字符
      name: { min: 1, max: 50 },
      username: { min: 1, max: 50 },
      email: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      // !!! 核心修改：comment 最小长度改为 1，最大 500
      comment: { min: 1, max: 500 },
      password: { min: 8, max: 100, requireLower: true, requireUpper: true, requireDigit: true },
      id: { regex: /^[a-zA-Z0-9_-]+$/ }
  },
  DEBOUNCE_DELAY: 300,
  SYNC_INTERVAL: 5000,
};

// --- 缓存 ---
const cache = new Map();
export function getCache(key) { /* ... same as before ... */
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CONFIG.CACHE_TTL * 1000) {
    logger.info('从缓存命中', { key });
    return entry.value;
  }
  cache.delete(key);
  logger.info('缓存未命中或过期', { key });
  return null;
}
function setCache(key, value) { /* ... same as before ... */
  cache.set(key, { value, timestamp: Date.now() });
  logger.info('已设置缓存', { key });
}
function invalidateCache(keyPrefix) { /* ... same as before ... */
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) {
      cache.delete(key);
      logger.info('已失效缓存', { key });
    }
  }
}

// --- Firebase 初始化 ---
let app, db;
export function validateEnv() { /* ... same as before ... */
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) {
    logger.error('缺失env变量: ' + missing.join(', '));
    throw new Error('Missing environment variables: ' + missing.join(', '));
  }
}
export async function initFirebase() { /* ... same as before ... */
  if (db) return db;
  try {
    validateEnv();
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN, databaseURL: process.env.FIREBASE_DATABASE_URL,
      projectId: process.env.FIREBASE_PROJECT_ID, storageBucket: process.env.FIREBASE_STORAGE_BUCKET, messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID, appId: process.env.FIREBASE_APP_ID
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

// --- 数据库操作 ---
function withTimeout(promise, ms) { /* ... same as before ... */
  const timeoutMs = ms || CONFIG.TIMEOUT;
  const timeoutPromise = new Promise((_, reject) => {
    const id = setTimeout(() => { clearTimeout(id); reject(new Error(`Firebase operation timed out after ${timeoutMs}ms`)); }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

export async function read(path, options) { /* ... same as before ... */
  const opts = options || {}; const timeout = opts.timeout || CONFIG.TIMEOUT; const cacheKey = 'read:' + path;
  const cached = getCache(cacheKey);
  if (cached !== null) { logger.info('从缓存读取: ' + path); return cached; }
  try {
    const dbInstance = await initFirebase(); const dbRef = ref(dbInstance, path);
    const snapshot = await withTimeout(get(dbRef), timeout); const value = snapshot.val() || null;
    setCache(cacheKey, value); logger.info('数据库读取成功 (路径: ' + path + ')');
    return value;
  } catch (err) { logger.error('数据库读取失败 (路径: ' + path + '):', err); throw err; }
}

export async function write(path, data, options) { /* ... same as before ... */
  const opts = options || {}; const method = opts.method || 'set'; const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const dbInstance = await initFirebase(); let writePromise; let newRef = null;
    switch (method) {
      case 'set': writePromise = set(ref(dbInstance, path), data); break;
      case 'update': writePromise = update(ref(dbInstance, path), data); break;
      case 'push': newRef = push(ref(dbInstance, path)); writePromise = set(newRef, data); break;
      default: throw new Error('Unsupported write method: ' + method);
    }
    await withTimeout(writePromise, timeout);
    logger.info('数据成功写入路径: ' + path, { method, data: newRef ? null : data });
    invalidateCache('read:' + path.split('/').slice(0, 2).join('/'));
    if (method === 'push' && newRef) return { key: newRef.key };
    return;
  } catch (err) { logger.error('数据库写入失败 (路径: ' + path + '):', err); throw err; }
}

export async function transaction(path, updateFn, options) { /* ... same as before ... */
  const opts = options || {}; const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const dbInstance = await initFirebase();
    const result = await withTimeout(runTransaction(ref(dbInstance, path), currentValue => updateFn(currentValue || null)), timeout);
    logger.info('事务操作完成: ' + path, { committed: result.committed, snapshotValue: result.snapshot.val() });
    invalidateCache('read:' + path);
    return result;
  } catch (err) { logger.error('事务操作失败 (路径: ' + path + '):', err); throw err; }
}

export async function del(path, options) { /* ... same as before ... */
  const opts = options || {}; const timeout = opts.timeout || CONFIG.TIMEOUT;
  try {
    const dbInstance = await initFirebase();
    await withTimeout(remove(ref(dbInstance, path)), timeout);
    logger.info('数据删除成功: ' + path);
    invalidateCache('read:' + path.split('/').slice(0, 2).join('/'));
  } catch (err) { logger.error('数据删除失败 (路径: ' + path + '):', err); throw err; }
}

// --- 输入处理与验证 ---

/**
 * 清理输入字符串：仅移除 HTML 标签，不移除其他 Unicode 字符。
 * @param {any} input - 输入值
 * @returns {string} - 清理后的字符串
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    logger.warn('sanitizeInput: 输入不是字符串', { input });
    return '';
  }
  try {
    // 移除 <script>...</script> 标签及其内容
    let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    // 移除所有其他 HTML 标签
    sanitized = sanitized.replace(/<[^>]+>/g, '');
    // !!! 核心修改：不再移除任何 Unicode 字符，仅移除 HTML 标签
    sanitized = sanitized.trim(); // 去除首尾空格
    logger.info('sanitizeInput 成功（仅移除HTML标签）', { original: input.slice(0, 50), sanitized: sanitized.slice(0, 50) });
    return sanitized;
  } catch (error) {
    logger.error('sanitizeInput 失败', error, { input });
    return '';
  }
}

/**
 * 验证输入值是否符合特定类型规则。
 * @param {string} value - 输入的字符串值
 * @param {string} type - 验证类型 ('name', 'email', 'comment', 'username', 'password', 'id')
 * @returns {boolean} - 如果验证通过则返回 true，否则返回 false
 */
export function validateInput(value, type) {
  if (typeof value !== 'string') {
      logger.warn(`validateInput: 值不是字符串 (type: ${type})`, { value });
      return false;
  }

  let processedValue = value;
  const config = CONFIG.COMMENT_VALIDATION[type];

  if (!config) {
      logger.warn(`validateInput: 未知的验证类型 (type: ${type})`);
      return false;
  }

  // !!! 核心修改：name 和 username 类型不进行 sanitizeInput，comment 类型进行。
  if (type === 'comment') {
      processedValue = sanitizeInput(value);
  }

  switch (type) {
    case 'name':
    case 'username': // name 和 username 规则统一：1-50字符，不再有格式限制
      return processedValue.length >= config.min && processedValue.length <= config.max;

    case 'email':
      return config.regex.test(processedValue);

    case 'comment':
      // !!! 核心修改：comment 最小长度改为 1
      return processedValue.length >= config.min && processedValue.length <= config.max;

    case 'password':
      let passwordValid = true;
      if (processedValue.length < config.min || processedValue.length > config.max) passwordValid = false;
      if (config.requireLower && !/[a-z]/.test(processedValue)) passwordValid = false;
      if (config.requireUpper && !/[A-Z]/.test(processedValue)) passwordValid = false;
      if (config.requireDigit && !/\d/.test(processedValue)) passwordValid = false;
      return passwordValid;

    case 'id':
      return config.regex.test(processedValue) && processedValue.length >= 1;

    default:
      logger.warn(`validateInput: 处理了未知类型 ${type}`);
      return false;
  }
}

// --- HTTP 请求处理 ---
export async function parseBody(req) { /* ... same as before ... */
  if (req.body && typeof req.body === 'object' && !('pipeTo' in req.body)) return req.body;
  try {
    const contentType = req.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) return await req.json();
    if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text(); const params = new URLSearchParams(text); return Object.fromEntries(params.entries());
    }
    logger.warn('parseBody: 未处理的 Content-Type: ' + (contentType || '缺失')); return {};
  } catch (e) { logger.error('parseBody: 请求体解析失败:', e); return {}; }
}

export function setCORS(req) { /* ... same as before ... */
  const productionAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'https://*.vercel.app,https://*.kenhunshuchong.web.app').split(',');
  const wildcardDomains = productionAllowedOrigins.filter(o => o.includes('*'));
  const origin = req.headers.get('origin')?.toLowerCase();
  let originAllowed = false;
  if (origin) {
    originAllowed = productionAllowedOrigins.includes(origin);
    if (!originAllowed) {
      for (const wildcard of wildcardDomains) {
        const regex = new RegExp(`^${wildcard.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
        if (regex.test(origin)) { originAllowed = true; break; }
      }
    }
  }
  const allowOrigin = originAllowed ? origin : (process.env.NODE_ENV !== 'production' ? origin || '*' : 'null');
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? 'null' : allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  logger.info('CORS headers generated', { origin, originAllowed, allowOrigin });
  return headers;
}

// --- 评论相关计算 ---
export async function computeTotalLikes(postId, commentId, startDepth = 0) { /* ... same as before ... */
  const currentDepth = startDepth;
  if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn('computeTotalLikes: 递归深度超过最大限制，停止计算', { postId, commentId, currentDepth }); return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('computeTotalLikes: 无效的 postId 或 commentId', { postId, commentId }); return 0;
  }
  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn('computeTotalLikes: 评论不存在，无法计算点赞数', { postId, commentId }); return 0;
    }
    let currentCommentDirectLikes = typeof commentData.likes === 'number' ? commentData.likes : 0;
    let childrenTotalLikes = 0;
    if (commentData.children && typeof commentData.children === 'object') {
      const childrenIds = Object.keys(commentData.children);
      const childPromises = childrenIds.map(childId =>
        validateInput(childId, 'id') ? computeTotalLikes(postId, childId, currentDepth + 1) : Promise.resolve(0)
      );
      const childTotals = await Promise.allSettled(childPromises);
      childrenTotalLikes += childTotals.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
    }
    const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;
    logger.info('computeTotalLikes: 成功计算评论总点赞数', { postId, commentId, totalLikes: newTotalLikes, depth: currentDepth });
    return newTotalLikes;
  } catch (err) {
    logger.error('computeTotalLikes: 计算失败', { postId, commentId, error: err.message, stack: err.stack });
    throw err;
  }
}

// --- 版本信息 ---
export const VERSION = '1.9.0'; // 升级版本
