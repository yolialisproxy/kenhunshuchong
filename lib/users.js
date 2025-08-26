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
  if (!username || !validateInput(username, 'username')) throw new ValidationError('用户名无效 (1-50字符)');
  if (!email || !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (!password || !validateInput(password, 'password')) throw new ValidationError('密码太弱 (8-100字符，含大小写字母和数字)');

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
      passwordHash: hashedPassword,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isActive: true, // Default to active
      role: 'user' // Default role
    };
    await write(userPath, newUser, { method: 'set' });

    logger.info(`[UsersLib] registerUser: 用户注册成功 (username: ${username})`);
    // Return user data without password hash
    const { passwordHash, ...userWithoutHash } = newUser;
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
  // FIX: 根据用户要求，登录时不再对用户名和密码进行严格的格式检查。
  // 仅检查是否为空，实际匹配由 bcrypt.compare 和数据库查询完成。
  if (!username) throw new ValidationError('用户名不能为空');
  if (!password) throw new ValidationError('密码不能为空');
  // 移除了对 validateInput(username, 'username') 和 validateInput(password, 'password') 的严格调用
  // 确保即使是单个字符的用户名和密码，只要数据库匹配即可通过。

  const userPath = `${USERS_PATH}/${username}`;
  try {
    // --- 2. Retrieve User Data ---
    const user = await read(userPath);
    if (!user || !user.passwordHash) {
      logger.warn(`[UsersLib] loginUser: 用户不存在或密码哈希缺失 (username: ${username})`);
      throw new ValidationError('用户名或密码不正确');
    }

  // --- 临时调试日志 START ---
  logger.debug(`[UsersLib] Debugging login for user: ${username}`);
  logger.debug(`[UsersLib] Input password (plain): ${password}`); // 注意：生产环境绝不能打印明文密码！
  logger.debug(`[UsersLib] Stored password hash: ${user.passwordHash}`);
  // --- 临时调试日志 END ---

    // --- 3. Compare Passwords ---
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      logger.warn(`[UsersLib] loginUser: 密码不匹配 (username: ${username})`);
      throw new ValidationError('用户名或密码不正确');
    }

    // --- 4. Update Last Login Timestamp ---
    await write(userPath, { lastLogin: new Date().toISOString() }, { method: 'update' });

    logger.info(`[UsersLib] loginUser: 用户登录成功 (username: ${username})`);
    // Return user data without password hash
    const { passwordHash, ...userWithoutHash } = user;
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

  // In a stateless API, logout primarily involves client-side session clearing.
  // Here, we can optionally update a 'lastLogout' timestamp or invalidate a token if one was stored server-side.
  // For Firebase Realtime Database, we might just log the event or update a status.
  const userPath = `${USERS_PATH}/${username}`;
  try {
    const userExists = await read(userPath);
    if (!userExists) {
      logger.warn(`[UsersLib] logoutUser: 尝试登出的用户不存在 (username: ${username})`);
      // Still return success for idempotency, as the user is effectively "logged out" from the client's perspective.
      return { success: true, message: 'User not found, but logout considered successful.' };
    }

    // Optional: Update a lastLogout timestamp or set isActive to false if session management is more complex
    // await write(userPath, { lastLogout: new Date().toISOString(), isActive: false }, { method: 'update' });

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
    const { passwordHash, ...userWithoutHash } = user;
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
      if (!validateInput(updates.password, 'password')) throw new ValidationError('新密码太弱');
      allowedUpdates.passwordHash = await bcrypt.hash(updates.password, 10);
    }
    // Add other updatable fields as needed (e.g., role, if admin is performing)

    if (Object.keys(allowedUpdates).length === 0) {
      throw new ValidationError('没有提供可更新的有效字段');
    }

    await write(userPath, allowedUpdates, { method: 'update' });

    logger.info(`[UsersLib] updateUser: 用户资料更新成功 (username: ${username})`);
    const updatedUser = await read(userPath);
    const { passwordHash, ...userWithoutHash } = updatedUser;
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

    // --- Authorization Check (Example: Only admin or self-delete) ---
    // For simplicity, assuming this is called by an admin or a self-delete mechanism.
    // In a real app, you'd pass the 'requesterUsername' and check roles.
    // if (requesterUsername !== username && requesterRole !== 'admin') {
    //   throw new ValidationError('您无权删除此用户');
    // }

    await del(userPath);

    logger.info(`[UsersLib] deleteUser: 用户删除成功 (username: ${username})`);
    return { success: true, message: `User ${username} deleted.` };

  } catch (error) {
    logger.error(`[UsersLib] deleteUser: 删除用户失败 (username: ${username}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to delete user.');
  }
}
