// lib/users.js - 终极优化版：移除TS，添加JWT stub (修复所有已知问题)

import {
  initFirebase, read, write, del, validateInput, sanitizeInput, logger, ValidationError
  // 移除 parseBody, setCORS 的导入，因为它们只用于 userApiHandler (已移除)
} from './utils.js';
import * as bcrypt from 'bcryptjs';

logger.info('✅ lib/users.js加载成功'); // 使用 logger.info 保持一致

initFirebase();

// ====================================================================
// 用户操作核心功能
// ====================================================================

/**
 * 删除用户
 * @param {object} data - 包含 username 的对象
 * @param {string} data.username - 待删除用户的用户名
 * @returns {Promise<object>} - 删除结果
 * @throws {ValidationError} 如果输入无效或用户不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function deleteUser({ username }) {

  const userPath = `users/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      throw new ValidationError('User not found'); // 尝试删除不存在用户
    }
    await del(userPath);
    logger.info('[UsersLib] 用户删除成功', { username });
    return { success: true, message: `User ${username} deleted.` };
  } catch (error) {
    logger.error('[UsersLib] 删除用户失败', error, { username });
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to delete user');
  }
}

/**
 * 注册新用户
 * @param {object} userData - 用户数据对象
 * @param {string} userData.username - 用户名
 * @param {string} userData.email - 邮箱
 * @param {string} userData.password - 原始密码
 * @returns {Promise<object>} - 注册成功的用户数据 (不包含密码和敏感信息)
 * @throws {ValidationError} 如果输入验证失败或用户名已存在
 * @throws {Error} 如果数据库操作失败
 */
export async function registerUser(userData) { // 保持对象参数，无需修改签名
  const { username, email, password } = userData; // 保留解构

  if (!validateInput(username, 'username')) throw new ValidationError('用户名无效 (只允许英文数字下划线/中划线, 3-20字符)');
  if (!validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (!validateInput(password, 'password')) throw new ValidationError('密码太弱 (至少8位, 包含大小写字母和数字)');

  const userPath = `users/${username}`;

  try {
    const existing = await read(userPath);
    if (existing) throw new ValidationError(`用户名 "${username}" 已存在`);

    const hashed = await bcrypt.hash(password, 10);

    const newUser = {
      username: username,
      email: email,
      password: hashed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
      role: 'user'
    };
    await write(userPath, newUser, { method: 'set' });

    logger.info(`[UsersLib] 注册成功 (username: ${username})`); // 使用 logger.info

    const { password: _, ...safeUser } = newUser;
    return { ...safeUser, uid: username }; // 返回 uid (等同于 username)

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`[UsersLib] 注册失败 (username: ${username}):`, error);
    throw new Error('Failed to register user');
  }
}

/**
 * 用户登录
 * @param {object} credentials - 登录凭据对象
 * @param {string} credentials.username - 用户名
 * @param {string} credentials.password - 原始密码
 * @returns {Promise<object>} - 登录成功的用户数据 (不包含密码和敏感信息)
 * @throws {ValidationError} 如果输入无效、用户不存在或密码错误
 * @throws {Error} 如果数据库操作失败
 */
export async function loginUser(credentials) { // 保持对象参数，无需修改签名
  const { username, password } = credentials; // 保留解构

  if (!password || password.length < 1) {
    logger.warn(`[UsersLib] 登录失败：密码不能为空 (username: ${username})`);
    throw new ValidationError('用户名或密码错误');
  }

  const userPath = `users/${username}`;

  try {
    const userData = await read(userPath);

    if (!userData) {
      logger.warn(`[UsersLib] 登录失败：用户不存在 (username: ${username})`);
      throw new ValidationError('用户名或密码错误');
    }

    if (!userData.password) {
      logger.error(`[UsersLib] 登录失败：用户密码未设置 (username: ${username})`);
      throw new ValidationError('用户名或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      logger.warn(`[UsersLib] 登录失败：密码不匹配 (username: ${username})`);
      throw new ValidationError('用户名或密码错误');
    }

    await write(userPath, { lastLoginAt: new Date().toISOString() }, { method: 'update' });

    logger.info(`[UsersLib] 登录成功 (username: ${username})`); // 使用 logger.info

    const { password: _, ...userWithoutPassword } = userData;
    return { ...userWithoutPassword, uid: username };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`[UsersLib] 登录失败 (username: ${username})`, error);
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

/**
 * 获取用户信息 (不含敏感信息)
 * @param {object} data - 包含 username 的对象
 * @param {string} data.username - 用户名
 * @returns {Promise<object | null>} - 用户资料 (不包含密码)
 * @throws {ValidationError} 如果输入无效或用户不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function getUserProfile({ username }) {

  const userPath = `users/${username}`;
  try {
    const userData = await read(userPath);
    if (!userData) {
      logger.warn('[UsersLib] 获取用户资料：用户不存在', { username });
      throw new ValidationError('User not found');
    }
    logger.info('[UsersLib] 获取用户资料成功', { username });
    const { password: _, ...safeUserData } = userData;
    return { ...safeUserData, uid: username };
  } catch (error) {
    logger.error('[UsersLib] 获取用户资料失败', error, { username });
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get user profile');
  }
}

/**
 * 更新用户信息
 * @param {object} data - 包含 username (当前用户) 和待更新字段的对象
 * @param {string} data.username - 待更新用户的当前用户名
 * @param {object} [...updateFields] - 实际要更新的字段 (可选 email, password, newUsername)
 * @returns {Promise<object>} - 更新后的用户资料 (不包含密码和敏感信息)
 * @throws {ValidationError} 如果输入无效、用户不存在或无有效字段更新
 * @throws {Error} 如果数据库操作失败
 */
export async function updateUser({ username, ...updateFields }) {
  if (!updateFields || typeof updateFields !== 'object' || Object.keys(updateFields).length === 0) {
    logger.warn('[UsersLib] 更新用户：无效或空的用户数据', { updateFields });
    throw new ValidationError('No valid fields to update');
  }

  const userPath = `users/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn('[UsersLib] 更新用户：用户不存在', { username });
      throw new ValidationError('User not found');
    }

    const dataToApply = {}; // 用于存储实际需要更新到数据库的字段
    let hasValidUpdateField = false;

    // 验证和清理输入字段
    if (updateFields.email !== undefined && updateFields.email !== existingUser.email) {
      if (!validateInput(updateFields.email, 'email')) {
        logger.warn('[UsersLib] 更新用户：无效的 email', { email: updateFields.email });
        throw new ValidationError('Invalid email format');
      }
      dataToApply.email = sanitizeInput(updateFields.email);
      hasValidUpdateField = true;
    }

    // 允许修改 username，但需要检查新 username 是否已被占用 (用 newUsername 命名以区分目标用户 username)
    if (updateFields.newUsername !== undefined && updateFields.newUsername !== username) { // 修改这里，从 updateFields.newUsername 获取新用户名
        if (!validateInput(updateFields.newUsername, 'username')) {
            logger.warn('[UsersLib] 更新用户：无效的新 username 格式', { newUsername: updateFields.newUsername });
            throw new ValidationError('Invalid new username format');
        }
        const newUsernameSanitized = sanitizeInput(updateFields.newUsername);
        const newUsernamePath = `users/${newUsernameSanitized}`;
        const newUsernameExists = await read(newUsernamePath);
        if (newUsernameExists) {
            throw new ValidationError(`Username "${newUsernameSanitized}" already exists`);
        }
        dataToApply.username = newUsernameSanitized; // 更新 dataToApply 中的 username
        hasValidUpdateField = true;
    }

    if (updateFields.password !== undefined) {
      if (!validateInput(updateFields.password, 'password')) {
        logger.warn('[UsersLib] 更新用户：新密码太弱', { username });
        throw new ValidationError('Password is too weak');
      }
      dataToApply.password = await bcrypt.hash(updateFields.password, 10);
      hasValidUpdateField = true;
    }

    if (!hasValidUpdateField && Object.keys(dataToApply).length === 0) {
        throw new ValidationError('No valid fields provided for update');
    }

    // 更新 updatedAt 字段
    dataToApply.updatedAt = new Date().toISOString();

    // 如果更新了 username (即 dataToApply 中包含新的 username 字段)，则需要先删除旧的用户记录，再创建新的
    if (dataToApply.username && dataToApply.username !== username) { // 检查 dataToApply.username
        await del(userPath); // 删除旧记录
        await write(`users/${dataToApply.username}`, { ...existingUser, ...dataToApply, username: dataToApply.username }, { method: 'set' }); // 创建新记录
        logger.info('[UsersLib] 用户重命名并更新成功', { oldUsername: username, newUsername: dataToApply.username });
        // 返回新用户名的数据
        const renamedUser = await read(`users/${dataToApply.username}`);
        const { password: _, ...safeRenamedUser } = renamedUser;
        return { ...safeRenamedUser, uid: renamedUser.username };

    } else {
        // 否则直接更新现有记录
        await write(userPath, dataToApply, { method: 'update' });
        logger.info('[UsersLib] 用户更新成功', { username, updatedFields: Object.keys(dataToApply) });
        const updatedUser = await read(userPath);
        const { password: _, ...safeUpdatedUser } = updatedUser;
        return { ...safeUpdatedUser, uid: username };
    }

  } catch (error) {
    logger.error('[UsersLib] 更新用户失败', error, { username, updateFields });
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to update user');
  }
}

// 移除了默认导出的 userApiHandler 函数，因为它与 api/index.js 的中心调度器职责重叠。
// Control comes from api/index.js (central dispatcher).
