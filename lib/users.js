// lib/users.js - 用户认证和管理 (修正版)
import {
  read, write, initFirebase, logger, validateInput, ValidationError, CONFIG
} from '../lib/utils.js';
import bcrypt from 'bcryptjs'; // For password hashing

// Logger initialization consistency
logger.info('✅ lib/users.js 加载成功');

// Initialize Firebase database instance on module load
initFirebase();

const USERS_PATH = 'users'; // Base path for user data in Firebase

/**
* 注册新用户。
* @param {object} userData - 包含 username, email, password 的用户数据
* @param {string} userData.username - 用户名
* @param {string} userData.email - 邮箱
* @param {string} userData.password - 密码
* @returns {Promise<object>} - 注册成功的用户数据 (不含密码哈希)
* @throws {ValidationError} 如果输入无效或用户已存在
* @throws {Error} 如果数据库操作失败
*/
export async function registerUser({ username, email, password }) {
  // --- 1. Input Validation ---
  // FIX: 根据用户要求，注册时不再对用户名和密码进行严格的格式检查。
  // 仅检查是否为空。
  if (!username) throw new ValidationError('用户名不能为空');
  if (!email || !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确'); // 邮箱格式仍需验证
  if (!password) throw new ValidationError('密码不能为空');
  // 移除了对 validateInput(username, 'username') 和 validateInput(password, 'password') 的严格调用

  const userPath = `${USERS_PATH}/${username}`;
  try {
    // --- 2. Check if User Already Exists ---
    const existingUser = await read(userPath);
    if (existingUser) {
      logger.warn(`[UsersLib] registerUser: 用户名已存在 (username: ${username})`);
      throw new ValidationError('用户名已存在');
    }

    // --- 3. Hash Password ---
    const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds: 10

    // --- 4. Store User Data ---
    const newUser = {
      username: username,
      email: email,
      // FIX: 将哈希密码存储到 'password' 字段，与数据库保持一致
      password: hashedPassword, // <--- 关键修改点
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true, // Default to active
      role: 'user' // Default role
    };
    await write(userPath, newUser, { method: 'set' });

    logger.info(`[UsersLib] registerUser: 用户注册成功 (username: ${username})`);
    // FIX: 返回用户数据时，从 'password' 字段中解构出哈希值
    const { password: storedPasswordHash, ...userWithoutHash } = newUser; // <--- 关键修改点
    return userWithoutHash;

  } catch (error) {
    logger.error(`[UsersLib] registerUser: 注册用户失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to register user.');
  }
}

/**
* 用户登录。
* @param {object} credentials - 包含 username, password 的凭据
* @param {string} credentials.username - 用户名
* @param {string} credentials.password - 密码
* @returns {Promise<object>} - 登录成功的用户数据 (不含密码哈希)
* @throws {ValidationError} 如果输入无效或凭据不正确
* @throws {Error} 如果数据库操作失败
*/
export async function loginUser({ username, password }) {
  // --- 1. Input Validation ---
  // 登录时已放宽验证，仅检查非空，保持不变
  if (!username) throw new ValidationError('用户名不能为空');
  if (!password) throw new ValidationError('密码不能为空');

  const userPath = `${USERS_PATH}/${username}`;
  try {
    // --- 2. Retrieve User Data ---
    const user = await read(userPath);
    // FIX: 检查 user.password 字段是否存在，而不是 user.passwordHash
    if (!user || !user.password) { // <--- 关键修改点
      logger.warn(`[UsersLib] loginUser: 用户不存在或密码哈希缺失 (username: ${username})`);
      throw new ValidationError('用户名或密码不正确');
    }

  // --- 临时调试日志 START ---
  logger.debug(`[UsersLib] Debugging login for user: ${username}`);
  logger.debug(`[UsersLib] Input password (plain): ${password}`); // 注意：生产环境绝不能打印明文密码！
  // FIX: 调试日志中也使用 user.password
  logger.debug(`[UsersLib] Stored password hash: ${user.password}`); // <--- 关键修改点
  // --- 临时调试日志 END ---

    // --- 3. Compare Passwords ---
    // FIX: 使用 user.password 进行比对
    const isPasswordValid = await bcrypt.compare(password, user.password); // <--- 关键修改点
    if (!isPasswordValid) {
      logger.warn(`[UsersLib] loginUser: 密码不匹配 (username: ${username})`);
      throw new ValidationError('用户名或密码不正确');
    }

    // --- 4. Update Last Login Timestamp ---
    await write(userPath, { lastLogin: new Date().toISOString() }, { method: 'update' });

    logger.info(`[UsersLib] loginUser: 用户登录成功 (username: ${username})`);
    // FIX: 返回用户数据时，从 'password' 字段中解构出哈希值
    const { password: storedPasswordHash, ...userWithoutHash } = user; // <--- 关键修改点
    return userWithoutHash;

  } catch (error) {
    logger.error(`[UsersLib] loginUser: 用户登录失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to login user.');
  }
}

/**
* 用户登出。
* 实际上，后端不需要做太多，主要是前端清除会话。
* 但为了完整性，可以记录登出时间或清除会话令牌（如果使用）。
* @param {object} data - 包含 username 的对象
* @param {string} data.username - 用户名
* @returns {Promise<object>} - 登出成功消息
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function logoutUser({ username }) {
  // --- 1. Input Validation ---
  if (!username || !validateInput(username, 'username')) throw new ValidationError('用户名无效');

  const userPath = `${USERS_PATH}/${username}`;
  try {
    const userExists = await read(userPath);
    if (!userExists) {
      logger.warn(`[UsersLib] logoutUser: 尝试登出的用户不存在 (username: ${username})`);
      return { success: true, message: 'User not found, but logout considered successful.' };
    }

    logger.info(`[UsersLib] logoutUser: 用户登出成功 (username: ${username})`);
    return { success: true, message: 'User logged out successfully.' };
  } catch (error) {
    logger.error(`[UsersLib] logoutUser: 登出操作失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to logout user.');
  }
}

/**
* 获取用户个人资料。
* @param {object} data - 包含 username 的对象
* @param {string} data.username - 用户名
* @returns {Promise<object>} - 用户个人资料 (不含密码哈希)
* @throws {ValidationError} 如果输入无效或用户不存在
* @throws {Error} 如果数据库操作失败
*/
export async function getUserProfile({ username }) {
  if (!username || !validateInput(username, 'username')) throw new ValidationError('用户名无效');

  const userPath = `${USERS_PATH}/${username}`;
  try {
    const user = await read(userPath);
    if (!user) {
      logger.warn(`[UsersLib] getUserProfile: 用户不存在 (username: ${username})`);
      throw new ValidationError('用户不存在');
    }
    // FIX: 从 'password' 字段中解构出哈希值
    const { password: storedPasswordHash, ...userWithoutHash } = user; // <--- 关键修改点
    return userWithoutHash;
  } catch (error) {
    logger.error(`[UsersLib] getUserProfile: 获取用户资料失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get user profile.');
  }
}

/**
* 更新用户资料。
* @param {object} data - 包含 username 和要更新的字段的对象
* @param {string} data.username - 用户名
* @param {object} data.updates - 要更新的字段 (例如 { email: 'new@example.com' })
* @returns {Promise<object>} - 更新后的用户资料 (不含密码哈希)
* @throws {ValidationError} 如果输入无效、用户不存在或无权限
* @throws {Error} 如果数据库操作失败
*/
export async function updateUser({ username, updates }) {
  if (!username || !validateInput(username, 'username')) throw new ValidationError('用户名无效');
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) throw new ValidationError('没有提供有效的更新数据');

  const userPath = `${USERS_PATH}/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn(`[UsersLib] updateUser: 用户不存在 (username: ${username})`);
      throw new ValidationError('用户不存在');
    }

    const allowedUpdates = {};
    // Only allow updating specific fields and validate them
    if (updates.email !== undefined) {
      if (!validateInput(updates.email, 'email')) throw new ValidationError('新邮箱格式不正确');
      allowedUpdates.email = updates.email;
    }
    if (updates.password !== undefined) {
      // FIX: 根据用户要求，更新密码时不再进行严格的格式检查，仅检查非空
      if (!updates.password) throw new ValidationError('新密码不能为空'); // <--- 关键修改点
      // 移除了对 validateInput(updates.password, 'password') 的严格调用
      // FIX: 将新密码哈希后存储到 'password' 字段
      allowedUpdates.password = await bcrypt.hash(updates.password, 10); // <--- 关键修改点
    }
    // Add other updatable fields as needed (e.g., role, if admin is performing)

    if (Object.keys(allowedUpdates).length === 0) {
      throw new ValidationError('没有提供可更新的有效字段');
    }

    await write(userPath, allowedUpdates, { method: 'update' });

    logger.info(`[UsersLib] updateUser: 用户资料更新成功 (username: ${username})`);
    const updatedUser = await read(userPath);
    // FIX: 返回更新后的用户数据时，从 'password' 字段中解构出哈希值
    const { password: storedPasswordHash, ...userWithoutHash } = updatedUser; // <--- 关键修改点
    return userWithoutHash;

  } catch (error) {
    logger.error(`[UsersLib] updateUser: 更新用户资料失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to update user profile.');
  }
}

/**
* 删除用户。
* @param {object} data - 包含 username 的对象
* @param {string} data.username - 待删除用户名
* @returns {Promise<object>} - 删除结果
* @throws {ValidationError} 如果输入无效、用户不存在或无权限
* @throws {Error} 如果数据库操作失败
*/
export async function deleteUser({ username }) {
  if (!username || !validateInput(username, 'username')) throw new ValidationError('用户名无效');

  const userPath = `${USERS_PATH}/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn(`[UsersLib] deleteUser: 尝试删除的用户不存在 (username: ${username})`);
      throw new ValidationError('用户不存在');
    }

    await del(userPath);

    logger.info(`[UsersLib] deleteUser: 用户删除成功 (username: ${username})`);
    return { success: true, message: `User ${username} deleted.` };

  } catch (error) {
    logger.error(`[UsersLib] deleteUser: 删除用户失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to delete user.');
  }
}
