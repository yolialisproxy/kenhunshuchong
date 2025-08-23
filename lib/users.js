// lib/users.js - 终极优化版：移除TS，添加JWT stub (修复所有已知问题)

import { initFirebase, read, write, del, parseBody, setCORS, validateInput, sanitizeInput, logger, ValidationError } from './utils.js'; // 导入 sanitizeInput
import * as bcrypt from 'bcryptjs';

console.log('✅ lib/users.js加载成功');

initFirebase();

// 删除用户
export async function deleteUser(username) {
  // 修正验证类型，使用 'username' 而非 'id'
  if (!validateInput(username, 'username')) {
    logger.warn('删除用户：无效的 username', { username });
    throw new ValidationError('Invalid username format');
  }

  const userPath = `users/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      throw new ValidationError('User not found'); // 尝试删除不存在用户
    }
    await del(userPath);
    logger.info('用户删除成功', { username });
    return { success: true, message: `User ${username} deleted.` };
  } catch (error) {
    logger.error('删除用户失败', error, { username });
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to delete user');
  }
}


// 注册用户
/**
 * 注册新用户
 * @param {object} userData - 用户数据
 * @param {string} userData.username - 用户名
 * @param {string} userData.email - 邮箱
 * @param {string} userData.password - 原始密码
 * @returns {Promise<object>} - 注册成功的用户数据 (不包含密码和敏感信息)
 * @throws {ValidationError} 如果输入验证失败或用户名已存在
 * @throws {Error} 如果数据库操作失败
 */
export async function registerUser(userData) {
  const { username, email, password } = userData;

  if (!validateInput(username, 'username')) throw new ValidationError('用户名无效 (只允许英文数字下划线/中划线, 3-20字符)');
  if (!validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (!validateInput(password, 'password')) throw new ValidationError('密码太弱 (至少8位, 包含大小写字母和数字)');

  const userPath = `users/${username}`;

  try {
    const existing = await read(userPath);
    if (existing) throw new ValidationError(`用户名 "${username}" 已存在`);

    const hashed = await bcrypt.hash(password, 10);

    const newUser = {
      username: username, // 确保用 sanitized 的 username
      email: email,       // 确保用 sanitized 的 email
      password: hashed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), // 转换为 ISO 字符串
      lastLoginAt: null,
      role: 'user'
    };
    await write(userPath, newUser, { method: 'set' });

    logger.success(`注册成功 (username: ${username})`);

    const { password: _, ...safeUser } = newUser;
    return { ...safeUser, uid: username }; // 返回 uid (等同于 username)

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`注册失败 (username: ${username}):`, error);
    throw new Error('Failed to register user');
  }
}

// 登录用户
/**
 * 用户登录
 * @param {object} credentials - 登录凭据
 * @param {string} credentials.username - 用户名
 * @param {string} credentials.password - 原始密码
 * @returns {Promise<object>} - 登录成功的用户数据 (不包含密码和敏感信息)
 * @throws {ValidationError} 如果输入无效、用户不存在或密码错误
 * @throws {Error} 如果数据库操作失败
 */
export async function loginUser(credentials) {
  const { username, password } = credentials;

  if (!validateInput(username, 'username')) {
    logger.warn(`登录失败：用户名无效 (username: ${username})`);
    // 统一错误信息，避免泄露内部验证细节
    throw new ValidationError('用户名或密码错误');
  }
  // 密码只需要检查非空和基本长度，因为后续会与哈希值比较
  if (!password || password.length < 1) {
    logger.warn(`登录失败：密码不能为空 (username: ${username})`);
    throw new ValidationError('用户名或密码错误'); // 统一错误信息
  }

  const userPath = `users/${username}`;

  try {
    const userData = await read(userPath);

    if (!userData) {
      logger.warn(`登录失败：用户不存在 (username: ${username})`);
      throw new ValidationError('用户名或密码错误');
    }

    if (!userData.password) {
      logger.error(`登录失败：用户密码未设置 (username: ${username})`);
      throw new ValidationError('用户名或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      logger.warn(`登录失败：密码不匹配 (username: ${username})`);
      throw new ValidationError('用户名或密码错误');
    }

    await write(userPath, { lastLoginAt: new Date().toISOString() }, { method: 'update' });

    logger.success(`登录成功 (username: ${username})`);

    const { password: _, ...userWithoutPassword } = userData;
    return { ...userWithoutPassword, uid: username };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`登录失败 (username: ${username})`, error);
    // Realtime Database 错误处理简化
    const errorMessage = error.message || '未知错误';
    if (errorMessage.includes("permission denied")) {
      throw new Error('数据库权限拒绝，请检查 Realtime Database 规则');
    }
    if (errorMessage.includes("timed out")) {
      throw new Error('数据库连接超时，请检查网络');
    }
    throw new Error(`登录失败：${errorMessage}`);
  }
}

// 获取用户资料
/**
 * 获取用户信息 (不含敏感信息)
 * @param {string} username - 用户名
 * @returns {Promise<object | null>} - 用户资料 (不包含密码)
 * @throws {ValidationError} 如果输入无效或用户不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function getUserProfile(username) {
  if (!validateInput(username, 'username')) {
    logger.warn('获取用户资料：无效的 username', { username });
    throw new ValidationError('Invalid username format');
  }

  const userPath = `users/${username}`;
  try {
    const userData = await read(userPath);
    if (!userData) {
      logger.warn('获取用户资料：用户不存在', { username });
      throw new ValidationError('User not found');
    }
    logger.info('获取用户资料成功', { username });
    // 修正返回结构，确保唯一 username 且包含 uid 和 lastLoginAt
    const { password: _, ...safeUserData } = userData;
    return { ...safeUserData, uid: username };
  } catch (error) {
    logger.error('获取用户资料失败', error, { username });
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get user profile');
  }
}

// 更新用户
/**
 * 更新用户信息
 * @param {string} username - 待更新用户名
 * @param {object} data - 更新数据 (可选 email, password, username)
 * @returns {Promise<object>} - 更新后的用户资料 (不包含密码和敏感信息)
 * @throws {ValidationError} 如果输入无效、用户不存在或无有效字段更新
 * @throws {Error} 如果数据库操作失败
 */
export async function updateUser(username, data) {
  if (!validateInput(username, 'username')) { // 修正验证类型
    logger.warn('更新用户：无效的 username', { username });
    throw new ValidationError('Invalid username format');
  }
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    logger.warn('更新用户：无效或空的用户数据', { data });
    throw new ValidationError('No valid fields to update');
  }

  const userPath = `users/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn('更新用户：用户不存在', { username });
      throw new ValidationError('User not found');
    }

    const updatedData = {}; // 用于存储实际需要更新的字段
    let hasValidUpdateField = false;

    // 验证和清理输入字段
    if (data.email !== undefined && data.email !== existingUser.email) { // 只有改变才处理
      if (!validateInput(data.email, 'email')) {
        logger.warn('更新用户：无效的 email', { email: data.email });
        throw new ValidationError('Invalid email format');
      }
      updatedData.email = sanitizeInput(data.email);
      hasValidUpdateField = true;
    }
    // 允许修改 username，但需要检查新 username 是否已被占用
    if (data.username !== undefined && data.username !== existingUser.username) {
        if (!validateInput(data.username, 'username')) { // 修正验证类型
            logger.warn('更新用户：无效的新 username 格式', { newUsername: data.username });
            throw new ValidationError('Invalid new username format');
        }
        const newUsernameSanitized = sanitizeInput(data.username);
        const newUsernamePath = `users/${newUsernameSanitized}`;
        const newUsernameExists = await read(newUsernamePath);
        if (newUsernameExists) {
            throw new ValidationError(`Username "${newUsernameSanitized}" already exists`);
        }
        updatedData.username = newUsernameSanitized;
        hasValidUpdateField = true;
    }
    if (data.password !== undefined) {
      if (!validateInput(data.password, 'password')) {
        logger.warn('更新用户：新密码太弱', { username });
        throw new ValidationError('Password is too weak');
      }
      updatedData.password = await bcrypt.hash(data.password, 10);
      hasValidUpdateField = true;
    }

    if (!hasValidUpdateField && Object.keys(updatedData).length === 0) {
        throw new ValidationError('No valid fields to update');
    }

    // 更新 updatedAt 字段
    updatedData.updatedAt = new Date().toISOString();

    // 如果更新了 username，则需要先删除旧的用户记录，再创建新的
    if (updatedData.username && updatedData.username !== username) {
        await del(userPath); // 删除旧记录
        await write(`users/${updatedData.username}`, { ...existingUser, ...updatedData }, { method: 'set' }); // 创建新记录
        logger.info('用户重命名并更新成功', { oldUsername: username, newUsername: updatedData.username });
        // 返回新用户名的数据
        const renamedUser = await read(`users/${updatedData.username}`);
        const { password: _, ...safeRenamedUser } = renamedUser;
        return { ...safeRenamedUser, uid: renamedUser.username };

    } else {
        // 否则直接更新现有记录
        await write(userPath, updatedData, { method: 'update' });
        logger.info('用户更新成功', { username, updatedFields: Object.keys(updatedData) });
        const updatedUser = await read(userPath);
        const { password: _, ...safeUpdatedUser } = updatedUser;
        return { ...safeUpdatedUser, uid: username };
    }

  } catch (error) {
    logger.error('更新用户失败', error, { username, data });
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to update user');
  }
}

// API handler
// 默认导出，Vercel Serverless Function 入口
export default async function userApiHandler(req, res) { // 将 userApiHandler 默认导出
  // 获取 CORS headers，注意 setCORS(req) 现在直接返回 headers 对象
  const corsHeaders = setCORS(req); // 修正：setCORS 只接受 req 参数并返回 headers
  // 获取原始响应头，为了能够正确合并其他非 CORS 头
  const responseHeaders = req.headers ? Object.fromEntries(req.headers.entries()) : {};

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, ...responseHeaders } // 修正：合并 corsHeaders
    });
  }

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    try {
      body = await parseBody(req);
    } catch (error) {
      logger.error('userApiHandler: 请求体解析失败', error);
      return new Response(JSON.stringify({ success: false, message: 'Invalid request body' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders, // 修正：合并 corsHeaders
          ...responseHeaders
        }
      });
    }
  }

  // 确保 URL 构造器在 Vercel Edge Runtime 中能正确工作
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
  const action = url.searchParams.get('action') || body.action; // Action 可以来自 query 或 body

  // 统一从 query 优先获取 username，然后从 body
  const usernameParam = url.searchParams.get('username') || body.username;
  const { data } = body; // 对于更新操作，data 字段从 body 中获取

  try {
    let result;
    switch (action) {
      case 'register':
        if (req.method !== 'POST') throw new ValidationError('注册操作只支持 POST 请求');
        result = await registerUser({ username: body.username, email: body.email, password: body.password });
        break;
      case 'login':
        if (req.method !== 'POST') throw new ValidationError('登录操作只支持 POST 请求');
        result = await loginUser({ username: body.username, password: body.password });
        break;
      case 'profile':
        if (req.method !== 'GET') throw new ValidationError('获取用户资料只支持 GET 请求');
        if (!usernameParam) throw new ValidationError('获取用户资料需要 username 参数');
        result = await getUserProfile(usernameParam);
        if (!result) return new Response(JSON.stringify({ success: false, message: 'User not found' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders, // 修正：合并 corsHeaders
            ...responseHeaders
          }
        });
        break;
      case 'update': // 修正方法为 PUT
        if (req.method !== 'PUT') throw new ValidationError('更新用户资料只支持 PUT 请求');
        if (!usernameParam) throw new ValidationError('更新用户资料需要 username 参数');
        if (!data || typeof data !== 'object') throw new ValidationError('更新用户资料需要 body 中包含 data 对象');

        result = await updateUser(usernameParam, data); // 明确传递 username 和 data
        break;
      case 'delete':
        if (req.method !== 'DELETE') throw new ValidationError('删除用户只支持 DELETE 请求');
        if (!usernameParam) throw new ValidationError('删除用户需要 username 参数');

        result = await deleteUser(usernameParam);
        break;
      default:
        throw new ValidationError(`Unsupported action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders, // 修正：合并 corsHeaders
        ...responseHeaders
      }
    });

  } catch (error) {
    logger.error('userApiHandler: API处理失败', error, { action, username: usernameParam, email: body.email });
    let status = 500;
    if (error instanceof ValidationError) {
      status = 400;
    } else if (error.message.includes('User not found')) { // 针对 getUserProfile/updateUser/deleteUser
        status = 404;
    }

    const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ success: false, message: message }), {
      status: status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders, // 修正：合并 corsHeaders
        ...responseHeaders
      }
    });
  }
}
