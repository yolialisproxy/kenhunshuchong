// lib/users.js - 优化版：移除TS，添加JWT stub

import { initFirebase, read, write, del, parseBody, setCORS, validateInput, logger, ValidationError } from './utils.js';
import bcrypt from 'bcryptjs';

console.log('✅ lib/users.js加载成功');

initFirebase();

// 添加用户
export async function addUser(userId, data) {
  if (!validateInput(userId, 'id')) {
    logger.warn('无效的 userId', { userId });
    throw new ValidationError('Invalid userId');
  }
  if (!data || typeof data !== 'object' || !data.username || !validateInput(data.username, 'username')) {
    logger.warn('无效的用户数据', { data });
    throw new ValidationError('Invalid user data');
  }

  const userPath = `users/${userId}`;
  try {
    await write(userPath, {
      username: data.username,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, { method: 'set' });
    logger.info('用户添加成功', { userId });
    return { userId, username: data.username };
  } catch (error) {
    logger.error('添加用户失败', error, { userId });
    throw error;
  }
}

// 删除用户
export async function deleteUser(userId) {
  if (!validateInput(userId, 'id')) {
    logger.warn('无效的 userId', { userId });
    throw new ValidationError('Invalid userId');
  }

  const userPath = `users/${userId}`;
  try {
    await del(userPath);
    logger.info('用户删除成功', { userId });
    return { userId };
  } catch (error) {
    logger.error('删除用户失败', error, { userId });
    throw error;
  }
}

// 获取用户信息
export async function getUser(userId) {
  if (!validateInput(userId, 'id')) {
    logger.warn('无效的 userId', { userId });
    throw new ValidationError('Invalid userId');
  }

  const userPath = `users/${userId}`;
  try {
    const userData = await read(userPath);
    if (!userData) {
      logger.warn('用户不存在', { userId });
      throw new ValidationError('User not found');
    }
    logger.info('获取用户信息成功', { userId });
    return userData;
  } catch (error) {
    logger.error('获取用户信息失败', error, { userId });
    throw error;
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

async function handler(req, res) {
  userApiHandler(req, res);
}
