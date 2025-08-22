// 状态回顾：修复路径错误，转换为CommonJS，统一validateInput，添加Firebase/Vercel优化
const firebaseAdmin = require('firebase-admin');
const bcrypt = require('bcrypt');

console.log('✅ api/lib/utils.js加载成功');

const CONFIG = {
  TIMEOUT: 5000,
  MAX_RETRIES: 3,
  MAX_RECURSION_DEPTH: 50,
  MAX_COMMENT_LENGTH: 1000,
  MAX_NAME_LENGTH: 50,
};

// 初始化Firebase
function initFirebase() {
  if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  return firebaseAdmin.database();
}

// Firebase引用
const ref = (db, path) => db.ref(path);

// 超时包装器
async function withTimeout(promise, timeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('操作超时')), timeout)
    ),
  ]);
}

// 解析请求体
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', err => reject(err));
  });
}

// 设置CORS
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// 统一输入验证
function validateInput(input, type = 'text') {
  if (typeof input !== 'string') return false;
  switch (type) {
    case 'id':
      return /^[a-zA-Z0-9_-]+$/.test(input);
    case 'username':
      return input.length > 0 && input.length <= CONFIG.MAX_NAME_LENGTH;
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
    case 'password':
      return input.length >= 8 && /\d/.test(input) && /[a-zA-Z]/.test(input);
    case 'comment':
      return input.length > 0 && input.length <= CONFIG.MAX_COMMENT_LENGTH;
    default:
      return true;
  }
}

module.exports = {
  initFirebase,
  ref,
  set: firebaseAdmin.database().ref().set,
  get: firebaseAdmin.database().ref().get,
  update: firebaseAdmin.database().ref().update,
  remove: firebaseAdmin.database().ref().remove,
  runTransaction: firebaseAdmin.database().ref().transaction,
  parseBody,
  setCORS,
  withTimeout,
  bcrypt,
  validateInput,
  CONFIG,
};
