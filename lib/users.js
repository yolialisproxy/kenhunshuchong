// lib/users.js - 优化版：移除TS，添加JWT stub

import { initFirebase, read, write, del, parseBody, setCORS, validateInput, logger, ValidationError } from './utils.js';
import bcrypt from 'bcryptjs';

console.log('✅ lib/users.js加载成功');

initFirebase();

// 删除用户
export async function deleteUser(username) {
  if (!validateInput(username, 'id')) {
    logger.warn('无效的 username', { username });
    throw new ValidationError('Invalid username');
  }

  const userPath = `users/${username}`;
  try {
    await del(userPath);
    logger.info('用户删除成功', { username });
    return { username };
  } catch (error) {
    logger.error('删除用户失败', error, { username });
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
      updatedAt: Date.now(),
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

// 获取用户资料
export async function getUserProfile(username) {
  if (!validateInput(username, 'username')) {
    logger.warn('无效的 username', { username });
    throw new ValidationError('Invalid username');
  }

  const userPath = `users/${username}`;
  try {
    const userData = await read(userPath);
    if (!userData) {
      logger.warn('用户不存在', { username });
      throw new ValidationError('User not found');
    }
    logger.info('获取用户成功', { username });
    return {
      username,
      email: userData.email,
      username: userData.username,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt
    };
  } catch (error) {
    logger.error('获取用户失败', error, { username });
    throw error;
  }
}

// 更新用户
export async function updateUser(username, data) {
  if (!validateInput(username, 'username')) {
    logger.warn('无效的 username', { username });
    throw new ValidationError('Invalid username');
  }
  if (!data || typeof data !== 'object') {
    logger.warn('无效的用户数据', { data });
    throw new ValidationError('Invalid user data');
  }

  const userPath = `users/${username}`;
  try {
    // 验证用户是否存在
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn('用户不存在', { username });
      throw new ValidationError('User not found');
    }

    // 验证和清理输入字段
    const updatedData = {};
    if (data.email) {
      if (!validateInput(data.email, 'email')) {
        logger.warn('无效的 email', { email: data.email });
        throw new ValidationError('Invalid email');
      }
      updatedData.email = sanitizeInput(data.email);
    }
    if (data.username) {
      if (!validateInput(data.username, 'name')) {
        logger.warn('无效的 username', { username: data.username });
        throw new ValidationError('Invalid username');
      }
      updatedData.username = sanitizeInput(data.username);
    }
    if (data.password) {
      if (!validateInput(data.password, 'password')) {
        logger.warn('无效的 password', { username });
        throw new ValidationError('Invalid password');
      }
      updatedData.password = await bcrypt.hash(data.password, 10);
    }
    updatedData.updatedAt = Date.now();

    // 仅更新非空字段
    if (Object.keys(updatedData).length === 1 && updatedData.updatedAt) {
      logger.warn('无有效字段需要更新', { username });
      throw new ValidationError('No valid fields to update');
    }

    // 更新数据库
    await write(userPath, updatedData, { method: 'update' });
    logger.info('用户更新成功', { username, updatedFields: Object.keys(updatedData) });

    // 返回更新后的用户数据（不含密码）
    const updatedUser = await read(userPath);
    return {
      username,
      email: updatedUser.email,
      username: updatedUser.username,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt
    };
  } catch (error) {
    logger.error('更新用户失败', error, { username });
    throw error;
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
  const { type, action, username, postId, commentId, data } = body;

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
      case 'update':
        if (req.method !== 'UPDATE') throw new ValidationError('只支持UPDATE');
        result = await updateUser(username, data);
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
