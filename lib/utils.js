// lib/utils.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, push, update, remove, child } from 'firebase/database';
import bcrypt from 'bcryptjs';

// Firebase配置
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// 初始化Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 数据库操作方法
export const db = {
  // 获取数据
  async get(path) {
    try {
      const snapshot = await get(ref(database, path));
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error(`数据库获取错误 [${path}]:`, error);
      throw new Error('数据库获取失败');
    }
  },

  // 设置数据
  async set(path, data) {
    try {
      await set(ref(database, path), data);
      return true;
    } catch (error) {
      console.error(`数据库设置错误 [${path}]:`, error);
      throw new Error('数据库设置失败');
    }
  },

  // 添加数据
  async push(path, data) {
    try {
      const newRef = push(ref(database, path));
      await set(newRef, data);
      return newRef.key;
    } catch (error) {
      console.error(`数据库添加错误 [${path}]:`, error);
      throw new Error('数据库添加失败');
    }
  },

  // 更新数据
  async update(path, data) {
    try {
      await update(ref(database, path), data);
      return true;
    } catch (error) {
      console.error(`数据库更新错误 [${path}]:`, error);
      throw new Error('数据库更新失败');
    }
  },

  // 删除数据
  async remove(path) {
    try {
      await remove(ref(database, path));
      return true;
    } catch (error) {
      console.error(`数据库删除错误 [${path}]:`, error);
      throw new Error('数据库删除失败');
    }
  }
};

// 密码加密
export async function hashPassword(password) {
  try {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    console.error('密码加密错误:', error);
    throw new Error('密码处理失败');
  }
}

// 密码验证
export async function verifyPassword(password, hashedPassword) {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    console.error('密码验证错误:', error);
    throw new Error('密码验证失败');
  }
}

// 输入验证
export function validateInput(data, requiredFields) {
  const errors = [];

  for (const field of requiredFields) {
    if (!data[field]) {
      errors.push(`${field} 是必填项`);
    }
  }

  return errors.length > 0 ? errors : null;
}

// 错误处理
export function handleError(error, res) {
  console.error('API错误:', error);

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: '输入验证失败',
      details: error.message
    });
  }

  if (error.code === 'PERMISSION_DENIED') {
    return res.status(403).json({
      success: false,
      error: '权限不足'
    });
  }

  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? error.message : '服务器错误'
  });
}

// CORS设置
export function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
