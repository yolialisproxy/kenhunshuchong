// lib/utils.js - 评论最小长度改为1，兼容性至上
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

console.log('✅ lib/utils.js 加载成功');

// --- 自定义错误 ---
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// --- 日志 ---
// 修复拼写错误：console.lo -> console.log, console.war -> console.warn, console.erro -> console.error
function logInfo(message, context) { console.log(`ℹ️ [Utils] ${message}`, context || ''); };
function logWarn(message, context) { console.warn(`⚠️ [Utils] ${message}`, context || ''); };
function logError(message, error, context) { console.error(`❌ [Utils] ${message}`, context || '', error ? error.stack : ''); };
function logSuccess(message, context) { console.log(`✅ [Utils] ${message}`, context || ''); };

export const logger = { info: logInfo, warn: logWarn, error: logError, success: logSuccess };

// --- 配置 ---
export const CONFIG = {
  MAX_RETRIES: 3,
  RETRY_INTERVAL_BASE: 1000,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 20,
  CACHE_TTL: 300, // 缓存有效秒数
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  COMMENT_VALIDATION: {
      // name 和 username 规则统一为 1-50 字符
      name: { min: 1, max: 50 },
      username: { min: 1, max: 50 },
      email: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      // !!! 核心修改：comment 最小长度改为 1，最大 500
      comment: { min: 1, max: 500 },
      password: { min: 8, max: 100, requireLower: true, requireUpper: true, requireDigit: true },
      // !!! 保持一致性，添加 max 长度
      id: { regex: /^[a-zA-Z0-9_-]+$/, min: 1, max: 100 }
  },
  DEBOUNCE_DELAY: 300,
  SYNC_INTERVAL: 5000,
};

// --- 缓存 ---
const cache = new Map();
export function getCache(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CONFIG.CACHE_TTL * 1000) {
    logger.info('从缓存命中', { key });
    return entry.value;
  }
  cache.delete(key); // 清理过期的缓存项
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

// --- Firebase 初始化 ---
// 模拟 process.env，以便在非 Node.js 环境（如 Vercel Serverless Functions）中工作
// 在实际项目部署时，Vercel 会注入这些环境变量
const env = typeof process !== 'undefined' && process.env ? process.env : {};

export function validateEnv() {
  // 检查是否设置了必要的 Firebase 环境变量
  const required = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) {
    // 如果缺少环境变量，记录错误并抛出异常
    logger.error('缺失必要的 Firebase 环境变量: ' + missing.join(', '));
    throw new Error('Missing required Firebase environment variables: ' + missing.join(', '));
  }
}

let app, db;
export async function initFirebase() {
  // 如果 db 已经被初始化，直接返回
  if (db) return db;
  try {
    // 验证环境变量是否存在
    validateEnv();
    // 配置 Firebase SDK
    const firebaseConfig = {
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      databaseURL: env.FIREBASE_DATABASE_URL,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID
    };
    // 初始化 Firebase 应用
    app = initializeApp(firebaseConfig);
    // 获取数据库实例
    db = getDatabase(app);
    logger.success('Firebase 初始化成功');
    return db;
  } catch (err) {
    // 记录初始化失败的错误
    logger.error('Firebase 初始化失败:', err);
    throw err; // 重新抛出错误，让调用者处理
  }
}

// --- 数据库操作 ---
// 封装一个带超时的 Promise 函数
function withTimeout(promise, ms) {
  const timeoutMs = ms || CONFIG.TIMEOUT;
  const timeoutPromise = new Promise((_, reject) => {
    const id = setTimeout(() => {
      // 清除定时器，防止内存泄漏
      clearTimeout(id);
      // 拒绝 Promise，表明操作超时
      reject(new Error(`Firebase operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  // 使用 Promise.race 同时运行操作和超时，哪个先完成就以哪个结果为准
  return Promise.race([promise, timeoutPromise]);
}

export async function read(path, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  const cacheKey = 'read:' + path;

  // 尝试从缓存读取
  const cached = getCache(cacheKey);
  if (cached !== null) {
    logger.info('从缓存读取: ' + path);
    return cached;
  }

  try {
    const dbInstance = await initFirebase(); // 确保 Firebase 已初始化
    const dbRef = ref(dbInstance, path); // 创建数据库引用

    // 执行 get 操作，并加上超时
    const snapshot = await withTimeout(get(dbRef), timeout);
    const value = snapshot.val() || null; // 获取快照值，如果不存在则为 null

    setCache(cacheKey, value); // 将读取到的值存入缓存
    logger.info('数据库读取成功 (路径: ' + path + ')');
    return value;
  } catch (err) {
    // 记录读取失败的错误
    logger.error('数据库读取失败 (路径: ' + path + '):', err);
    throw err; // 重新抛出错误
  }
}

export async function write(path, data, options) {
  const opts = options || {};
  const method = opts.method || 'set'; // 默认使用 set 方法
  const timeout = opts.timeout || CONFIG.TIMEOUT;
  let newRef = null; // 用于存储 push 操作的新的引用

  try {
    const dbInstance = await initFirebase();
    let writePromise;

    // 根据 method 执行不同的数据库写入操作
    switch (method) {
      case 'set': // 覆盖写入
        writePromise = set(ref(dbInstance, path), data);
        break;
      case 'update': // 部分更新
        writePromise = update(ref(dbInstance, path), data);
        break;
      case 'push': // 自动生成 key 并写入
        newRef = push(ref(dbInstance, path)); // 创建一个新的、带唯一 ID 的引用
        writePromise = set(newRef, data); // 使用 set 方法写入数据
        break;
      default:
        // 如果方法不支持，抛出错误
        throw new Error('Unsupported write method: ' + method);
    }

    await withTimeout(writePromise, timeout); // 等待写入操作完成（带超时）

    logger.info('数据成功写入路径: ' + path, { method, data: newRef ? null : data, key: newRef ? newRef.key : null });

    // 写入成功后，使与该路径相关的缓存失效
    // invalidateCache('read:' + path.split('/').slice(0, 2).join('/')); // 失效父级目录缓存
    invalidateCache('read:' + path); // 更精确地失效当前路径缓存

    // 如果是 push 操作，返回新生成的 key
    if (method === 'push' && newRef) return { key: newRef.key };
    return; // 成功，无返回值
  } catch (err) {
    // 记录写入失败的错误
    logger.error('数据库写入失败 (路径: ' + path + '):', err);
    throw err; // 重新抛出错误
  }
}

export async function transaction(path, updateFn, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    // 执行 runTransaction 操作，并带超时
    const result = await withTimeout(runTransaction(ref(dbInstance, path), currentValue => updateFn(currentValue || null)), timeout);

    logger.info('事务操作完成: ' + path, { committed: result.committed, snapshotValue: result.snapshot.val() });

    // 事务成功后，使相关缓存失效
    // invalidateCache('read:' + path.split('/').slice(0, 2).join('/'));
    invalidateCache('read:' + path); // 失效当前路径缓存

    return result;
  } catch (err) {
    // 记录事务失败的错误
    logger.error('事务操作失败 (路径: ' + path + '):', err);
    throw err; // 重新抛出错误
  }
}

export async function del(path, options) {
  const opts = options || {};
  const timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    const dbInstance = await initFirebase();
    // 执行 remove 操作，并带超时
    await withTimeout(remove(ref(dbInstance, path)), timeout);
    logger.info('数据删除成功: ' + path);

    // 删除后，使相关缓存失效
    // invalidateCache('read:' + path.split('/').slice(0, 2).join('/'));
    invalidateCache('read:' + path); // 失效当前路径缓存
  } catch (err) {
    // 记录删除失败的错误
    logger.error('数据删除失败 (路径: ' + path + '):', err);
    throw err; // 重新抛出错误
  }
}

// --- 输入处理与验证 ---

/**
* 清理输入字符串：仅移除 HTML 标签，不移除其他 Unicode 字符。
* @param {any} input - 输入值
* @returns {string} - 清理后的字符串
*/
export function sanitizeInput(input) {
  // 确保输入是字符串，如果不是，返回空字符串并记录警告
  if (typeof input !== 'string') {
    logger.warn('sanitizeInput: 输入不是字符串', { input });
    return '';
  }
  try {
    // !!! 核心修改：LiberatedCore 视角 - 移除所有 HTML 标签剥离逻辑。
    // 我们的目标是呈现，而不是主动净化。HTML 的安全渲染应由展示层处理（如 escapeHTML）。
    // 此函数现在只做极简的输入清理（去除首尾空格）。

    // 仅去除首尾空格
    let sanitized = input.trim();
    logger.info('sanitizeInput 成功（仅去除首尾空格）', { original: input.slice(0, 50), sanitized: sanitized.slice(0, 50) });
    return sanitized;
  } catch (error) {
    // 如果发生错误，记录并返回空字符串
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
  // 确保输入值是字符串
  if (typeof value !== 'string') {
      logger.warn(`validateInput: 值不是字符串 (type: ${type})`, { value });
      return false;
  }

  // 从配置中获取特定类型的验证规则
  const config = CONFIG.COMMENT_VALIDATION[type];
  if (!config) {
      logger.warn(`validateInput: 未知的验证类型 (type: ${type})`);
      return false;
  }

  // !!! 核心修改：comment 类型不再调用 sanitizeInput 进行 HTML 剥离。
  // 验证逻辑将直接作用于原始输入字符串（已确保是 string 类型）。
  let processedValue = value;
  if (type === 'comment') {
      // 仅保留对 sanitizeInput 的调用，但 sanitizeInput 的行为已修改为不剥离 HTML
      processedValue = sanitizeInput(value);
  }

  // 根据类型执行不同的验证逻辑
  switch (type) {
    case 'name':
    case 'username':
      // !!! 核心修改：name 和 username 规则统一：1-50字符，不再有格式限制
      // 确保长度在配置的 min 和 max 范围内
      return processedValue.length >= (config.min || 0) && processedValue.length <= config.max;
    case 'email':
      // 使用正则表达式验证邮箱格式
      return config.regex.test(processedValue);
    case 'comment':
      // !!! 核心修改：comment 最小长度改为 1
      // 验证评论内容的长度
      return processedValue.length >= (config.min || 0) && processedValue.length <= config.max;
    case 'password':
      // 验证密码的长度和复杂度要求
      let passwordValid = true;
      if (processedValue.length < (config.min || 0) || processedValue.length > config.max) passwordValid = false;
      if (config.requireLower && !/[a-z]/.test(processedValue)) passwordValid = false;
      if (config.requireUpper && !/[A-Z]/.test(processedValue)) passwordValid = false;
      if (config.requireDigit && !/\d/.test(processedValue)) passwordValid = false;
      return passwordValid;
    case 'id':
      // 验证 ID 的格式和长度
      return config.regex.test(processedValue) && processedValue.length >= (config.min || 0) && processedValue.length <= config.max;
    default:
      // 对于未知的验证类型，记录警告并返回 false
      logger.warn(`validateInput: 处理了未知类型 ${type}`);
      return false;
  }
}

// --- HTTP 请求处理 ---

/**
 * 解析请求体，支持 JSON 和 application/x-www-form-urlencoded 格式。
 * @param {Request} req - Vercel Serverless Function 的 Request 对象。
 * @returns {Promise<object>} - 解析后的请求体对象。如果解析失败或 Content-Type 不支持，则返回空对象。
 */
export async function parseBody(req) {
  // 如果 req.body 已经是解析过的对象（例如 Vercel 已经处理过）并且不是 ReadableStream，直接返回。
  // ('pipeTo' in req.body) 是一个检查 ReadableStream 的常见方式。
  if (req.body && typeof req.body === 'object' && !('pipeTo' in req.body)) {
    // console.log('[Utils] parseBody: req.body is already parsed object'); // Debug log
    return req.body;
  }

  try {
    const contentType = req.headers.get('content-type');
    // console.log('[Utils] parseBody: Content-Type detected:', contentType); // Debug log

    if (contentType && contentType.includes('application/json')) {
      // Handle JSON request body
      // req.json() reads the stream and parses it as JSON
      return await req.json();
    } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      // Handle form URL-encoded request body
      const text = await req.text(); // Read the raw text body
      const params = new URLSearchParams(text); // Parse it using URLSearchParams
      // Convert URLSearchParams to a plain object
      return Object.fromEntries(params.entries());
    } else {
      // If Content-Type is missing or not supported, log a warning and return empty object
      logger.warn('parseBody: 未处理的 Content-Type 或 Content-Type 缺失', { contentType: contentType || '缺失' });
      return {};
    }
  } catch (e) {
    // Catch any errors during parsing (e.g., invalid JSON)
    logger.error('parseBody: 请求体解析失败', e, { url: req.url, method: req.method });
    // Return empty object on error to prevent application crash
    return {};
  }
}

// 不需要return，也不需要去掉'*'，这是为了现阶段方便。
export function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- 评论相关计算 ---

/**
 * 递归计算评论及其所有子评论的总点赞数。
 * @param {string} postId - 文章ID。
 * @param {string} commentId - 当前评论的ID。
 * @param {number} [startDepth=0] - 当前递归深度。
 * @returns {Promise<number>} - 该评论及其所有子评论的总点赞数。
 */
export async function computeTotalLikes(postId, commentId, startDepth = 0) {
  const currentDepth = startDepth;

  // 递归深度检查
  if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn('computeTotalLikes: 递归深度超过最大限制，停止计算', { postId, commentId, currentDepth });
    return 0;
  }

  // 输入验证
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('computeTotalLikes: 无效的 postId 或 commentId', { postId, commentId });
    return 0;
  }

  // 构建评论在数据库中的路径
  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath); // 读取评论数据

    // 如果评论不存在，则返回 0
    if (!commentData) {
      logger.warn('computeTotalLikes: 评论不存在，无法计算点赞数', { postId, commentId });
      return 0;
    }

    // 获取当前评论的直接点赞数
    let currentCommentDirectLikes = typeof commentData.likes === 'number' ? commentData.likes : 0;
    let childrenTotalLikes = 0;

    // 如果存在子评论
    if (commentData.children && typeof commentData.children === 'object') {
      const childrenIds = Object.keys(commentData.children);
      // 递归调用 computeTotalLikes 计算每个子评论的点赞数
      const childPromises = childrenIds.map(childId =>
        validateInput(childId, 'id')
          ? computeTotalLikes(postId, childId, currentDepth + 1)
          : Promise.resolve(0) // 无效的 childId 返回 0
      );
      // 使用 Promise.allSettled 等待所有子评论的计算完成
      const childTotals = await Promise.allSettled(childPromises);
      // 累加所有成功计算的子评论点赞数
      childrenTotalLikes += childTotals.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
    }

    // 计算当前评论及其所有子评论的总点赞数
    const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;
    logger.info('computeTotalLikes: 成功计算评论总点赞数', { postId, commentId, totalLikes: newTotalLikes, depth: currentDepth });
    return newTotalLikes;
  } catch (err) {
    // 捕获并记录计算过程中发生的错误
    logger.error('computeTotalLikes: 计算失败', { postId, commentId, error: err.message, stack: err.stack });
    throw err; // 重新抛出错误
  }
}

// --- 版本信息 ---
export const VERSION = '1.9.1'; // 提升版本号以反映最终修复
