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

  // 1. 输入验证 (使用 utils.validateInput 进行统一验证)
  if (!validateInput(username, 'username')) {
    logger.warn(`登录失败：用户名无效 (username: ${username})`); // 使用导入的 logger
    throw new ValidationError('用户名无效（2-50个字符，仅限字母、数字、下划线）');
  }
  // 密码只需要检查非空和基本长度，因为后续会与哈希值比较
  if (password === undefined || password === null || typeof password !== 'string' || password.length < 1) { // 调整密码验证，不再严格检查强度，只检查非空
    logger.warn(`登录失败：密码不能为空 (username: ${username})`);
    throw new ValidationError('密码不能为空');
  }

  const userPath = `users/${username}`; // Realtime Database 的用户路径

  try {
    // 2. 使用 lib/utils.js 的 read 函数从 Realtime Database 获取用户数据
    const userData = await read(userPath); // 使用 read 函数

    // 3. 检查用户是否存在
    if (!userData) {
      logger.warn(`登录失败：用户不存在 (username: ${username})`);
      throw new ValidationError('用户名或密码错误'); // 统一错误信息，避免泄露用户是否存在
    }

    // 4. 检查是否设置了密码字段
    if (!userData.password) {
      logger.error(`登录失败：用户密码未设置 (username: ${username})`);
      throw new ValidationError('用户名或密码错误'); // 统一错误信息
    }

    // 5. 验证密码：将用户输入的明文密码与数据库中存储的哈希密码进行比较
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      logger.warn(`登录失败：密码不匹配 (username: ${username})`);
      throw new ValidationError('用户名或密码错误'); // 统一错误信息
    }

    // 6. 更新最后登录时间 (使用 lib/utils.js 的 write 函数进行更新)
    await write(userPath, { lastLoginAt: new Date().toISOString() }, { method: 'update' }); // 使用 write 函数

    logger.success(`登录成功 (username: ${username})`); // 使用导入的 logger

    // 7. 返回不包含密码哈希的敏感信息
    const { password: _, ...userWithoutPassword } = userData; // 解构去除密码
    return { ...userWithoutPassword, uid: username }; // 假设 username 就是 uid，并添加 uid

  } catch (error) { // 捕获使用 Realtime Database 操作可能出现的错误
    if (error instanceof ValidationError) {
      throw error; // 直接抛出验证错误
    }
    logger.error(`登录失败 (username: ${username})`, error); // 使用导入的 logger
    // Realtime Database 的错误代码不同于 Firestore，这里简化处理
    // 可以根据实际 Realtime Database 抛出的错误类型进行更细致的错误处理
    if (error.message.includes("permission denied")) { // 示例，根据实际错误消息进行判断
      throw new Error('无权限访问用户数据，请检查 Realtime Database 规则');
    }
    if (error.message.includes("timed out")) { // 示例
      throw new Error('数据库连接失败或超时，请检查网络');
    }
    throw new Error(`登录失败：${error.message || '未知错误'}`);
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
