// lib/users.js - 统一的用户注册、登录、信息获取业务逻辑模块，并提供一个默认导出的HTTP接口

// 从 utils.js 导入底层数据库操作、HTTP 辅助函数、以及核心的计算和验证工具
import {
  read, write, del, transaction, initFirebase,
  parseBody, setCORS, validateInput // 新增导入 validateInput，移除 withTimeout
} from '../lib/utils.js';
import bcrypt from 'bcryptjs'; // 导入 bcryptjs 用于密码哈希和验证

console.log('✅ lib/users.js加载成功');

initFirebase(); // 确保 Firebase 数据库实例已初始化

/**
 * 结构化日志记录器
 * 用于在用户模块中提供统一的日志输出
 */
const logger = {
  info: (message, context = {}) => console.log(`ℹ️ [UserService] ${message}`, context),
  warn: (message, context = {}) => console.warn(`⚠️ [UserService] ${message}`, context),
  error: (message, error, context = {}) => console.error(`❌ [UserService] ${message}`, context, error ? error.stack : ''),
  success: (message, context = {}) => console.log(`✅ [UserService] ${message}`, context),
};

/**
 * 自定义验证错误类
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ====================================================================
// 用户业务逻辑功能 (不直接接触 HTTP request/response)
// ====================================================================

/**
 * 注册新用户
 * @param {object} userData - 用户数据
 * @param {string} userData.username - 用户名
 * @param {string} userData.email - 邮箱
 * @param {string} userData.password - 原始密码
 * @returns {Promise<object>} - 注册成功的用户数据 (不包含密码)
 * @throws {ValidationError} 如果输入验证失败或用户名已存在
 * @throws {Error} 如果数据库操作失败
 */
export async function registerUser(userData) { // 移除 TypeScript 类型注解
  const { username, email, password } = userData;

  // 1. 输入验证 (使用 utils.validateInput 进行统一验证)
  if (!validateInput(username, 'username')) {
    throw new ValidationError('用户名无效 (只允许英文数字下划线/中划线, 3-20字符)');
  }
  if (!validateInput(email, 'email')) {
    throw new ValidationError('邮箱格式不正确');
  }
  if (!validateInput(password, 'password')) {
    throw new ValidationError('密码太弱 (至少8位, 包含大小写字母和数字)');
  }

  const userPath = `users/${username}`;

  try {
    // 2. 检查用户名是否已存在
    const existingUser = await read(userPath);
    if (existingUser) {
      throw new ValidationError(`用户名 "${username}" 已存在`);
    }

    // 3. 哈希密码
    const hashedPassword = await bcrypt.hash(password, 10); // saltRounds = 10

    // 4. 构建并写入用户数据
    const newUser = {
      username,
      email,
      password: hashedPassword, // 存储哈希后的密码
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      role: 'user'
    };
    await write(userPath, newUser, { method: 'set' });

    logger.success(`用户注册成功 ( username: ${username}, email: ${email} )`);

    // 返回不包含密码哈希的敏感信息
    const { password: _, ...userWithoutPassword } = newUser; // 解构去除密码
    return { ...userWithoutPassword, uid: username }; // 假设 username 就是 uid，并添加 uid

  } catch (error) { // 移除 TypeScript 类型注解
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`注册用户失败 (username: ${username}):`, error);
    throw new Error('Failed to register user');
  }
}

/**
 * 用户登录
 * @param {object} credentials - 登录凭据
 * @param {string} credentials.username - 用户名
 * @param {string} credentials.password - 原始密码
 * @returns {Promise<object>} - 登录成功的用户数据 (不包含密码)
 * @throws {ValidationError} 如果输入无效、用户不存在或密码错误
 * @throws {Error} 如果数据库操作失败
 */
export async function loginUser(credentials) { // 移除 TypeScript 类型注解
  const { username, password } = credentials;

  // 1. 输入验证 (使用 utils.validateInput 进行统一验证)
  if (!validateInput(username, 'username')) {
    throw new ValidationError('用户名无效');
  }
  if (!validateInput(password, 'password')) { // 理论上这里只需要检查非空，强度不需要再检查
    throw new ValidationError('密码不能为空');
  }

  const userPath = `users/${username}`;

  try {
    // 2. 查找用户
    const userData = await read(userPath);
    if (!userData) {
      throw new ValidationError('用户名或密码错误'); // 统一错误信息，避免泄露用户是否存在
    }

    // 3. 验证密码
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      throw new ValidationError('用户名或密码错误'); // 统一错误信息
    }

    // 4. 更新最后登录时间
    await write(userPath, { lastLoginAt: new Date().toISOString() }, { method: 'update' });

    logger.success(`用户登录成功 ( username: ${username} )`);
    // 返回不包含密码哈希的敏感信息
    const { password: _, ...userWithoutPassword } = userData; // 解构去除密码
    return { ...userWithoutPassword, uid: username}; // 假设 username 就是 uid，并添加 uid

  } catch (error) { // 移除 TypeScript 类型注解
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`登录用户失败 (username: ${username}):`, error);
    throw new Error('Failed to login user');
  }
}

/**
 * 获取用户信息 (不含敏感信息)
 * @param {string} username - 用户名
 * @returns {Promise<object | null>}
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getUserProfile(username) { // 移除 TypeScript 类型注解
  // 1. 输入验证
  if (!validateInput(username, 'username')) {
    throw new ValidationError('用户名无效');
  }

  const userPath = `users/${username}`;
  try {
    const userData = await read(userPath);
    if (!userData) {
      return null;
    }
    // 返回不包含密码哈希的敏感信息
    const { password, ...safeUserData } = userData; // 解构去除密码
    return { ...safeUserData, uid: username }; // 假设 username 就是 uid，并添加 uid
  } catch (error) { // 移除 TypeScript 类型注解
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`获取用户资料失败 (username: ${username}):`, error);
    throw new Error('Failed to get user profile');
  }
}

// ====================================================================
// 默认导出的 HTTP API 接口函数 (为 api/index.js 调用而设计)
// ====================================================================

/**
 * 默认导出的 HTTP API 接口函数。
 * 处理所有用户相关的 HTTP 请求 (注册、登录)。
 * @param {Request} req - HTTP请求对象，Vercel环境下的Web标准Request对象
 * @param {Response} res - HTTP响应对象，Vercel环境下的Web标准Response对象
 * @returns {Promise<Response>} - 包含操作结果的HTTP响应
 */
export default async function userApiHandler(req, res) { // 移除 TypeScript 类型注解
  // 设置 CORS 头，处理预检请求
  setCORS(res, req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: res.headers });
  }

  let body = {}; // 移除 TypeScript 类型注解
  try {
    body = await parseBody(req); // 使用从 utils.js 导入的 parseBody
  } catch (parseError) { // 移除 TypeScript 类型注解
    logger.error('请求体解析失败', parseError);
    return new Response(JSON.stringify({ success: false, message: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...res.headers.raw() },
    });
  }

  // 从 URL query 或 body 中获取 action
  const url = new URL(req.url || '', `http://${req.headers.get('host')}`);
  const action = url.searchParams.get('action') || body.action;

  try {
    let result; // 移除 TypeScript 类型注解
    switch (action) {
      case 'register':
        if (req.method !== 'POST') {
          throw new ValidationError('注册操作只支持 POST 请求');
        }
        // 确保将参数作为 userData 对象传递给 registerUser
        result = await registerUser({ username: body.username, email: body.email, password: body.password });
        logger.success(`用户注册 API 调用成功 (username: ${body.username})`);
        break;
      case 'login':
        if (req.method !== 'POST') {
          throw new ValidationError('登录操作只支持 POST 请求');
        }
        // 确保将参数作为 credentials 对象传递给 loginUser
        result = await loginUser({ username: body.username, password: body.password });
        logger.success(`用户登录 API 调用成功 (username: ${body.username})`);
        break;
      case 'profile': // 获取用户资料 (例如，通过一个GET请求)
        if (req.method !== 'GET') {
          throw new ValidationError('获取用户资料只支持 GET 请求');
        }
        const username = url.searchParams.get('username') || body.username; // 可以从查询参数或请求体获取
        if (!username) {
          throw new ValidationError('获取用户资料需要 username 参数');
        }
        result = await getUserProfile(username);
        if (!result) {
          return new Response(JSON.stringify({ success: false, message: 'User not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...res.headers.raw() },
          });
        }
        logger.success(`获取用户资料 API 调用成功 (username: ${username})`);
        break;
      default:
        throw new ValidationError(`Unsupported action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...res.headers.raw() },
    });

  } catch (error) { // 移除 TypeScript 类型注解
    logger.error('用户API处理失败', error, { action, username: body.username, email: body.email });
    const status = error.name === 'ValidationError' ? 400 : 500;
    return new Response(JSON.stringify({ success: false, message: error.message || 'Internal server error' }), {
      status: status,
      headers: { 'Content-Type': 'application/json', ...res.headers.raw() },
    });
  }
}

// 导出所有功能函数 (包括默认导出的API接口和所有的业务逻辑函数)
export {
  registerUser,
  loginUser,
  getUserProfile,
  ValidationError
};
