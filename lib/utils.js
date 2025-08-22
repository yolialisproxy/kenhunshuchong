// lib/utils.js - 最终ES Module版本，旨在与项目其他文件和Vercel环境兼容

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
import sanitizeHtml from 'sanitize-html'; // 再次使用 ES Module 导入

console.log('✅ lib/utils.js加载成功');

// 简单日志记录器
const logger = {
  info: (message, meta) => { // 使用箭头函数和 const
    console.log('[INFO] Utils>>>', message, meta || {});
  },
  warn: (message, meta) => {
    console.warn('[WARN] Utils>>>', message, meta || {});
  },
  error: (message, error, meta) => {
    console.error('[ERROR] Utils>>>', message, meta || {}, error ? error.stack : 'No stacktrace available');
  }
};

// 配置对象
const CONFIG = { // 使用 const
  MAX_RETRIES: 3,
  TIMEOUT: 5000,
  MAX_RECURSION_DEPTH: 10,
  CACHE_TTL: 300 // 5分钟缓存 (目前未使用)
};

// 模块功能说明
// ============
// 这是博客项目的数据库操作模块，负责与Firebase Realtime Database的交互
// 提供基础的数据读写、事务操作、错误处理等功能
// 作者：Your Name
// 版本：1.5.0 (ES Module 版本)
// 最后修改日期：2025-08-22 (统一ES Module)

// 初始化 Firebase 应用的变量
let appInstance; // 使用 let
let dbInstance;

/**
 * 验证环境变量的存在性
 */
function validateEnv() {
  const required = [ // 使用 const
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
  ];
  const missing = required.filter(key => !process.env[key]); // 使用箭头函数
  if (missing.length) {
    logger.error('缺失env变量: ' + missing.join(', '));
    throw new Error('Missing environment variables: ' + missing.join(', '));
  }
}

/**
 * 初始化Firebase数据库实例
 */
export async function initFirebase() { // export
  if (dbInstance) return dbInstance;
  try {
    validateEnv();

    const firebaseConfig = { // 使用 const
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };

    appInstance = initializeApp(firebaseConfig);
    dbInstance = getDatabase(appInstance);
    logger.info('Firebase初始化成功');
    return dbInstance;

  } catch (err) {
    logger.error('Firebase初始化失败:', err);
    throw err;
  }
}

/**
 * 为异步操作添加超时控制
 * promise - 待执行的 Promise
 * ms - 超时时间，默认为 CONFIG.TIMEOUT
 */
export async function withTimeout(promise, ms) { // export
  const timeoutMilliseconds = ms || CONFIG.TIMEOUT; // 使用 const
  const timeoutPromise = new Promise((_, reject) => { // 使用箭头函数
    setTimeout(() => { // 使用箭头函数
      reject(new Error('Firebase operation timed out'));
    }, timeoutMilliseconds);
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * DB读取操作
 * path - 数据库路径
 * options - 配置选项，包含 once (是否只读取一次) 和 timeout (超时时间)
 */
export async function read(path, options) { // export
  const opts = options || {}; // 使用 const
  const once = (opts.once === undefined) ? true : opts.once; // 使用 const
  const timeout = opts.timeout || CONFIG.TIMEOUT; // 使用 const

  try {
    const fbDb = await initFirebase(); // 使用 const
    const dbRef = ref(fbDb, path); // 使用 const
    const result = await withTimeout(
      once ? get(dbRef) : dbRef.once('value'),
      timeout
    );
    const snapshot = result; // 使用 const
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

/**
 * DB写入操作
 * path - 数据库路径
 * data - 待写入的数据
 * options - 配置选项，包含 method ('set', 'update', 'push') 和 timeout (超时时间)
 */
export async function write(path, data, options) { // export
  const opts = options || {}; // 使用 const
  const method = opts.method || 'set'; // 使用 const
  const timeout = opts.timeout || CONFIG.TIMEOUT; // 使用 const

  try {
    const fbDb = await initFirebase(); // 使用 const
    let writePromise; // 使用 let
    let newRef; // 使用 let

    switch (method) {
      case 'set':
        writePromise = set(ref(fbDb, path), data);
        break;
      case 'update':
        writePromise = update(ref(fbDb, path), data);
        break;
      case 'push':
        newRef = push(ref(fbDb, path), data);
        return await withTimeout(newRef, timeout); // push 方法特殊处理，返回引用
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

/**
 * DB事务操作
 * path - 数据库路径
 * updateFn - 更新函数 (接收当前值，返回新值或 undefined/null)
 * options - 配置选项，包含 timeout (超时时间)
 */
export async function transaction(path, updateFn, options) { // export
  const opts = options || {}; // 使用 const
  const timeout = opts.timeout || CONFIG.TIMEOUT; // 使用 const

  try {
    const fbDb = await initFirebase(); // 使用 const
    const result = await withTimeout(
      runTransaction(ref(fbDb, path), (currentValue) => { // 使用箭头函数
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

/**
 * DB删除操作
 * path - 数据库路径
 * options - 配置选项，包含 timeout (超时时间)
 */
export async function del(path, options) { // export
  const opts = options || {}; // 使用 const
  const timeout = opts.timeout || CONFIG.TIMEOUT; // 使用 const

  try {
    const fbDb = await initFirebase(); // 使用 const
    await withTimeout(remove(ref(fbDb, path)), timeout);
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

/**
 * 清理输入字符串，移除 HTML 标签，防止 XSS 攻击。
 * input - 原始输入字符串
 */
export function sanitizeInput(input) { // export
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, {
    allowedTags: [], // 不允许任何HTML标签
    allowedAttributes: {} // 不允许任何HTML属性
  });
}

/**
 * 验证输入值是否符合指定类型。
 * value - 待验证的值
 * type - 验证类型 ('id', 'name', 'email', 'comment', 'username', 'password')
 */
export function validateInput(value, type) { // export
  const sanitized = sanitizeInput(value); // 使用 const
  let regex; // 使用 let

  switch (type) {
    case 'id':
      regex = /^[a-zA-Z0-9_-]+$/;
      return regex.test(sanitized);
    case 'name':
      return sanitized.length >= 2 && sanitized.length <= 50;
    case 'email':
      regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return regex.test(sanitized);
    case 'comment':
      return sanitized.length >= 5 && sanitized.length <= 500;
    case 'username':
      regex = /^[a-zA-Z0-9_-]{3,20}$/;
      return regex.test(sanitized);
    case 'password':
      // 至少8位, 包含大小写字母和数字
      return sanitized.length >= 8 && sanitized.length <= 100 && /[a-z]/.test(sanitized) && /[A-Z]/.test(sanitized) && /\d/.test(sanitized);
    default:
      return false;
  }
}

/**
 * 解析HTTP请求体
 * req - HTTP请求对象 (Vercel环境下的Web标准 Request 对象)
 */
export async function parseBody(req) { // export
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  try {
    const contentType = req.headers.get('content-type'); // 使用 const

    if (contentType && contentType.includes('application/json')) {
      return await req.json();
    }
    if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text(); // 使用 const
      const params = new URLSearchParams(text); // 使用 const
      return Object.fromEntries(params.entries());
    }
    logger.warn('parseBody: Unhandled Content-Type or body format: ' + (contentType || 'missing content-type'));
    return {};
  } catch (e) {
    logger.warn('Request body parsing failed:', e);
    return {};
  }
}

/**
 * 设置CORS跨域头
 * res - HTTP响应对象
 * req - 原始HTTP请求对象
 */
export function setCORS(res, req) { // export
  const allowedOrigins = [ // 使用 const
    'https://*.vercel.app',
    'http://localhost:1313'
    // TODO: 添加您的 Hugo 博客生产域名，例如 'https://your-hugo-blog.com'
  ];
  const origin = req.headers.get('Origin'); // 使用 const

  let originAllowed = false; // 使用 let
  let i; // 使用 let
  if (origin) {
    for (i = 0; i < allowedOrigins.length; i++) {
      const ao = allowedOrigins[i]; // 使用 const
      if (ao === origin) {
        originAllowed = true;
        break;
      }
      if (ao.includes('*.') && origin.startsWith('https://')) { // 检查是否包含通配符并确保是 HTTPS
        const domainPatternIndex = ao.indexOf('*.') + 2; // 获取通配符后的域名模式开始索引
        const domainPattern = ao.substring(domainPatternIndex); // 例如从 'https://*.vercel.app' 得到 'vercel.app'

        // 确保 origin 匹配域名模式且是有效的子域名
        if (origin.endsWith(domainPattern)) {
            // 获取子域名部分，例如 'sub.vercel.app' 的 'sub'
            const subPart = origin.substring(0, origin.length - (domainPattern.length + 1)); // +1是为了移除 '.'
            // 检查 subPart 不为空且不包含额外的 '.' （避免匹配像 'https://.vercel.app' 或 'https://a.b.vercel.app'）
            if (subPart.length > 0 && subPart.indexOf('.') === -1) {
                originAllowed = true;
                break;
            }
        }
      }
    }
  }

  // 根据匹配结果设置 Access-Control-Allow-Origin
  if (originAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV !== 'production') {
    // 开发环境下为方便调试，临时允许所有来源
    res.headers.set('Access-Control-Allow-Origin', '*');
  } else {
    // 生产环境，如果不在白名单，默认仍然设置 * (为兼容性考虑，更严格的应不设置此头或返回错误)
    res.headers.set('Access-Control-Allow-Origin', '*');
  }

  // 设置允许的HTTP方法和请求头
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Max-Age', '86400'); // 预检请求缓存24小时
}

/**
 * 计算评论及其子评论的总点赞数 (递归函数)。
 * postId - 文章ID
 * commentId - 评论ID
 * depth - 当前递归深度，防止无限递归
 */
export async function computeTotalLikes(postId, commentId, depth) { // export
  const currentDepth = depth || 0; // 使用 const
  if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn('递归深度超过' + CONFIG.MAX_RECURSION_DEPTH, { postId: postId, commentId: commentId });
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('无效的 postId 或 commentId', { postId: postId, commentId: commentId });
    return 0;
  }

  const commentPath = 'comments/' + postId + '/' + commentId; // 使用 const

  try {
    const commentData = await read(commentPath); // 使用 const
    if (!commentData) {
      logger.warn('评论不存在', { postId: postId, commentId: commentId });
      return 0;
    }

    let currentCommentDirectLikes = commentData.likes || 0; // 使用 let
    let childrenTotalLikes = 0; // 使用 let

    if (commentData.children && typeof commentData.children === 'object') {
      const childrenIds = Object.keys(commentData.children); // 使用 const
      const childPromises = childrenIds.map(childId => // 使用箭头函数
        validateInput(childId, 'id') ? computeTotalLikes(postId, childId, currentDepth + 1) : Promise.resolve(0)
      );
      const childTotals = await Promise.allSettled(childPromises); // 使用 const

      childrenTotalLikes = childTotals.reduce((sum, result) => { // 使用箭头函数
        return sum + (result.status === 'fulfilled' ? result.value : 0);
      }, 0);
    }

    const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes; // 使用 const
    return newTotalLikes;

  } catch (err) {
    logger.error('computeTotalLikes失败', { postId: postId, commentId: commentId, error: err.message, stack: err.stack });
    throw err;
  }
}

// 模块出口 (ES Module 风格)
export {
  initFirebase, read, write, del, transaction,
  computeTotalLikes, parseBody, setCORS, withTimeout, validateInput, CONFIG,
  sanitizeInput,
};

// 模块版本信息
export const VERSION = '1.5.0'; // export
