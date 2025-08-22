// lib/utils.js - 终极重写版，旨在解决Vercel上的SyntaxError

// 导入 Firebase SDK 的必要模块
var firebaseApp = require('firebase/app');
var firebaseDatabase = require('firebase/database');
var sanitizeHtml = require('sanitize-html'); // 使用 CommonJS require 语法

console.log('✅ lib/utils.js加载成功');

// 简单日志记录器，使用传统函数声明
var logger = {
  info: function(message, meta) {
    console.log('[INFO] Utils>>>', message, meta || {}); // 使用 || {} 确保 meta 始终是对象
  },
  warn: function(message, meta) {
    console.warn('[WARN] Utils>>>', message, meta || {});
  },
  error: function(message, error, meta) {
    console.error('[ERROR] Utils>>>', message, meta || {}, error ? error.stack : 'No stacktrace available');
  }
};

// 配置对象
var CONFIG = {
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
// 版本：1.4.0 (重写后新版本)
// 最后修改日期：2025-08-22 (今日超保守重写)

// 初始化 Firebase 应用的变量
var appInstance;
var dbInstance;

/**
 * 验证环境变量的存在性
 */
function validateEnv() {
  var required = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
  ];
  var missing = required.filter(function(key) { // 使用传统函数声明
    return !process.env[key];
  });
  if (missing.length) {
    logger.error('缺失env变量: ' + missing.join(', '));
    throw new Error('Missing environment variables: ' + missing.join(', '));
  }
}

/**
 * 初始化Firebase数据库实例
 */
async function initFirebase() {
  if (dbInstance) return dbInstance; // 如果已初始化，直接返回
  try {
    validateEnv(); // 验证环境变量

    var firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };

    appInstance = firebaseApp.initializeApp(firebaseConfig);
    dbInstance = firebaseDatabase.getDatabase(appInstance);
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
async function withTimeout(promise, ms) {
  var timeoutMilliseconds = ms || CONFIG.TIMEOUT;
  var timeoutPromise = new Promise(function(_, reject) { // 使用传统函数声明
    setTimeout(function() { // 使用传统函数声明
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
async function read(path, options) {
  var opts = options || {};
  var once = (opts.once === undefined) ? true : opts.once;
  var timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    var fbDb = await initFirebase();
    var dbRef = firebaseDatabase.ref(fbDb, path);
    var result = await withTimeout(
      once ? firebaseDatabase.get(dbRef) : dbRef.once('value'),
      timeout
    );
    var snapshot = result;
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
async function write(path, data, options) {
  var opts = options || {};
  var method = opts.method || 'set';
  var timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    var fbDb = await initFirebase();
    var writePromise;
    var newRef; // 用于 push 方法的返回值

    switch (method) {
      case 'set':
        writePromise = firebaseDatabase.set(firebaseDatabase.ref(fbDb, path), data);
        break;
      case 'update':
        writePromise = firebaseDatabase.update(firebaseDatabase.ref(fbDb, path), data);
        break;
      case 'push':
        newRef = firebaseDatabase.push(firebaseDatabase.ref(fbDb, path), data);
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
async function transaction(path, updateFn, options) {
  var opts = options || {};
  var timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    var fbDb = await initFirebase();
    var result = await withTimeout(
      firebaseDatabase.runTransaction(firebaseDatabase.ref(fbDb, path), function(currentValue) {
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
async function del(path, options) {
  var opts = options || {};
  var timeout = opts.timeout || CONFIG.TIMEOUT;

  try {
    var fbDb = await initFirebase();
    await withTimeout(firebaseDatabase.remove(firebaseDatabase.ref(fbDb, path)), timeout);
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
function sanitizeInput(input) {
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
function validateInput(value, type) {
  var sanitized = sanitizeInput(value);
  var regex;

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
async function parseBody(req) {
  // 检查 req.body 是否已经是一个对象 (例如，由框架预先解析)
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  try {
    var contentType = req.headers.get('content-type'); // 获取 Content-Type 头

    if (contentType && contentType.indexOf('application/json') > -1) { // 检查是否包含 'application/json'
      return await req.json();
    }
    if (contentType && contentType.indexOf('application/x-www-form-urlencoded') > -1) { // 检查是否包含表单类型
      var text = await req.text();
      var params = new URLSearchParams(text);
      return Object.fromEntries(params.entries()); // 将 URLSearchParams 转换为普通对象
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
function setCORS(res, req) {
  var allowedOrigins = [
    'https://*.vercel.app',
    'http://localhost:1313'
    // TODO: 添加您的 Hugo 博客生产域名，例如 'https://your-hugo-blog.com'
  ];
  var origin = req.headers.get('Origin'); // 获取请求的 Origin 头

  var originAllowed = false;
  var i;
  if (origin) {
    for (i = 0; i < allowedOrigins.length; i++) {
      var ao = allowedOrigins[i];
      if (ao === origin) { // 精确匹配
        originAllowed = true;
        break;
      }
      if (ao.indexOf('https://*.') === 0 && origin.indexOf('https://') === 0) { // 通配符子域名匹配
        var domainPattern = ao.substring(9); // 例如从 'https://*.vercel.app' 得到 'vercel.app'
        if (origin.endsWith(domainPattern)) {
          var subdomainPart = origin.substring('https://'.length, origin.length - domainPattern.length);
          // 确保匹配的是一个完整的子域名，而不是 'https://.example.com' 这种无效形式
          if (subdomainPart === '' || (subdomainPart.endsWith('.') && subdomainPart.indexOf('.') === subdomainPart.length - 1) || (subdomainPart.indexOf('.') === -1)) {
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
async function computeTotalLikes(postId, commentId, depth) {
  var currentDepth = depth || 0; // 手动处理默认值
  if (currentDepth > CONFIG.MAX_RECURSION_DEPTH) {
    logger.warn('递归深度超过' + CONFIG.MAX_RECURSION_DEPTH, { postId: postId, commentId: commentId });
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('无效的 postId 或 commentId', { postId: postId, commentId: commentId });
    return 0;
  }

  var commentPath = 'comments/' + postId + '/' + commentId; // 字符串拼接

  try {
    var commentData = await read(commentPath);
    if (!commentData) {
      logger.warn('评论不存在', { postId: postId, commentId: commentId });
      return 0;
    }

    var currentCommentDirectLikes = commentData.likes || 0;
    var childrenTotalLikes = 0;

    if (commentData.children && typeof commentData.children === 'object') {
      var childrenIds = Object.keys(commentData.children);
      var childPromises = childrenIds.map(function(childId) { // 使用传统函数声明
        return validateInput(childId, 'id') ? computeTotalLikes(postId, childId, currentDepth + 1) : Promise.resolve(0);
      });
      var childTotals = await Promise.allSettled(childPromises);

      childrenTotalLikes = childTotals.reduce(function(sum, result) { // 使用传统函数声明
        return sum + (result.status === 'fulfilled' ? result.value : 0);
      }, 0);
    }

    var newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;
    return newTotalLikes;

  } catch (err) {
    logger.error('computeTotalLikes失败', { postId: postId, commentId: commentId, error: err.message, stack: err.stack });
    throw err;
  }
}

// 导出所有功能函数，使用 exports.functionName 形式
exports.initFirebase = initFirebase;
exports.read = read;
exports.write = write;
exports.del = del;
exports.transaction = transaction;
exports.computeTotalLikes = computeTotalLikes;
exports.parseBody = parseBody;
exports.setCORS = setCORS;
exports.withTimeout = withTimeout;
exports.validateInput = validateInput;
exports.CONFIG = CONFIG;
exports.sanitizeInput = sanitizeInput;

// 模块版本信息
exports.VERSION = '1.4.0';
