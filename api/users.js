// lib/users.js - 优化版：移除TS，添加JWT stub

import {
  read, write, initFirebase,
  parseBody, setCORS, validateInput
} from '../lib/utils.js';
import bcrypt from 'bcryptjs';

console.log('✅ lib/users.js加载成功');

initFirebase();

const logger = {
  info: function(message, context) { console.log(`ℹ️ [UserService] ${message}`, context || ''); },
  warn: function(message, context) { console.warn(`⚠️ [UserService] ${message}`, context || ''); },
  error: function(message, error, context) { console.error(`❌ [UserService] ${message}`, context || '', error ? error.stack : ''); },
  success: function(message, context) { console.log(`✅ [UserService] ${message}`, context || ''); },
};

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// 注册用户
export async function registerUser(userData) {
  const { username, email, password } = userData;

  if (!validateInput(username, 'username')) throw new ValidationError('用户名无效');
  if (!validateInput(email, 'email')) throw new ValidationError('邮箱无效');
  if (!validateInput(password, 'password')) throw new ValidationError('密码太弱');

  const userPath = `users/${username}`;

  try {
    const existing = await read(userPath);
    if (existing) throw new ValidationError(`用户名 "${username}" 已存在`);

    const hashed = await bcrypt.hash(password, 10);

    const newUser = {
      username,
      email,
      password: hashed,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      role: 'user'
    };
    await write(userPath, newUser, { method: 'set' });

    logger.success(`注册成功 (username: ${username})`);

    const { password: _, ...safeUser } = newUser;
    return { ...safeUser, uid: username };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`注册失败 (username: ${username}):`, error);
    throw new Error('Failed to register');
  }
}

// 登录用户
export async function loginUser(credentials) {
  const { username, password } = credentials;

  if (!validateInput(username, 'username')) throw new ValidationError('用户名无效');
  if (!password) throw new ValidationError('密码不能为空');

  const userPath = `users/${username}`;

  try {
    const userData = await read(userPath);
    if (!userData) throw new ValidationError('用户名或密码错误');

    const valid = await bcrypt.compare(password, userData.password);
    if (!valid) throw new ValidationError('用户名或密码错误');

    await write(userPath, { lastLoginAt: new Date().toISOString() }, { method: 'update' });

    logger.success(`登录成功 (username: ${username})`);

    const { password: _, ...safeUser } = userData;
    return { ...safeUser, uid: username };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`登录失败 (username: ${username}):`, error);
    throw new Error('Failed to login');
  }
}

// 获取资料
export async function getUserProfile(username) {
  if (!validateInput(username, 'username')) throw new ValidationError('用户名无效');

  const userPath = `users/${username}`;
  try {
    const userData = await read(userPath);
    if (!userData) return null;

    const { password, ...safe } = userData;
    return { ...safe, uid: username };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`获取资料失败 (username: ${username}):`, error);
    throw new Error('Failed to get profile');
  }
}

// API handler
export async function userApiHandler(req, res) {
  setCORS(res, req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  let body = {};
  try {
    body = await parseBody(req);
  } catch (error) {
    logger.error('解析失败', error);
    return new Response(JSON.stringify({ success: false, message: 'Invalid body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || body.action;

  try {
    let result;
    switch (action) {
      case 'register':
        if (req.method !== 'POST') throw new ValidationError('只支持POST');
        result = await registerUser({ username: body.username, email: body.email, password: body.password });
        break;
      case 'login':
        if (req.method !== 'POST') throw new ValidationError('只支持POST');
        result = await loginUser({ username: body.username, password: body.password });
        break;
      case 'profile':
        if (req.method !== 'GET') throw new ValidationError('只支持GET');
        const username = url.searchParams.get('username') || body.username;
        if (!username) throw new ValidationError('需username');
        result = await getUserProfile(username);
        if (!result) return new Response(JSON.stringify({ success: false, message: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        break;
      default:
        throw new ValidationError(`Unsupported action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    logger.error('API失败', error, { action });
    const status = error.name === 'ValidationError' ? 400 : 500;
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Server error';
    return new Response(JSON.stringify({ success: false, message }), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

default async function handler(req, res) {
  userApiHandler(req, res);
}
