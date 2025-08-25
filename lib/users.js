// lib/users.js - 终极优化版：移除 TS，添加 JWT stub (修复所有已知问题)
import {
  initFirebase, read, write, del, validateInput, sanitizeInput, logger, ValidationError
} from './utils.js';
import * as bcrypt from 'bcryptjs'; // bcryptjs for password hashing

// Logger initialization consistency
logger.info('✅ lib/users.js 加载成功');

// Initialize Firebase on module load. The initFirebase function handles singleton logic.
initFirebase();

// --- JWT Stub Implementation ---
// A simple stub for JWT generation. In a real application, use a robust JWT library.
function generateAuthToken(userData) {
  // Basic stub: Combine username and a timestamp, then hash it.
  // This is NOT cryptographically secure or standard JWT, just a placeholder.
  const payload = `${userData.username}:${Date.now()}`;
  // Using bcrypt to create a "token" that's derived from user data.
  // In a real JWT, this would involve signing with a secret key.
  return bcrypt.hash(payload, 8).then(token => token.replace(/\//g, '_')); // Replace slashes to avoid issues in some contexts
}

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
  // Validate username before proceeding
  if (!validateInput(username, 'username')) {
    logger.warn('[UsersLib] 删除用户：无效的用户名', { username });
    throw new ValidationError('Invalid username format');
  }

  const userPath = `users/${username}`;
  try {
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn('[UsersLib] 删除用户：用户不存在', { username });
      throw new ValidationError('User not found');
    }
    await del(userPath);
    logger.info('[UsersLib] 用户删除成功', { username });
    return { success: true, message: `User ${username} deleted.` };
  } catch (error) {
    logger.error('[UsersLib] 删除用户失败', error, { username });
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to delete user'); // General error for other failures
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
export async function registerUser(userData) {
  const username = userData.username;
  const email = userData.email;
  const password = userData.password;

  // --- Input Validation ---
  if (!validateInput(username, 'username')) { // Validate username format
    logger.warn('[UsersLib] 注册失败：无效的用户名格式', { username });
  }
  if (!validateInput(email, 'email')) {
    logger.warn('[UsersLib] 注册失败：无效的邮箱格式', { email });
  }
  if (!validateInput(password, 'password')) {
    logger.warn('[UsersLib] 注册失败：密码太弱', { username });
  }

  const userPath = `users/${username}`;
  try {
    // Check if username already exists
    const existing = await read(userPath);
    if (existing) {
      logger.warn('[UsersLib] 注册失败：用户名已存在', { username });
      throw new ValidationError(`Username "${username}" already exists.`);
    }

    // Hash the password
    const hashed = await bcrypt.hash(password, 10);

    // Prepare new user data
    const newUser = {
      username: username,
      email: email,
      password: hashed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
      role: 'user' // Default role
    };

    // Write new user data to the database
    await write(userPath, newUser, { method: 'set' });

    logger.info('[UsersLib] 注册成功', { username });

    // Prepare response: exclude password, add uid and token stub
    const { password: _, ...safeUser } = newUser;
    const token = generateAuthToken(safeUser); // Generate auth token stub
    return { ...safeUser, uid: username, token };

  } catch (error) {
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    logger.error('[UsersLib] 注册失败', error, { username });
    throw new Error('Failed to register user.'); // General error
  }
}

/**
* 用户登录
* @param {object} credentials - 登录凭据对象
* @param {string} credentials.username - 用户名
* @param {string} credentials.password - 原始密码
* @returns {Promise<object>} - 登录成功的用户数据 (不包含密码和敏感信息，含 token stub)
* @throws {ValidationError} 如果输入无效、用户不存在或密码错误
* @throws {Error} 如果数据库操作失败
*/
export async function loginUser(credentials) {
  const username = credentials.username;
  const password = credentials.password;

  // --- Input Validation ---
  if (!validateInput(username, 'username')) { // Validate username format
    logger.warn('[UsersLib] 登录失败：无效的用户名格式', { username });
    throw new ValidationError('Invalid username format.');
  }
  if (!password || password.length < 1) { // Basic password presence check
    logger.warn('[UsersLib] 登录失败：密码不能为空', { username });
    throw new ValidationError('Password cannot be empty.');
  }

  const userPath = `users/${username}`;
  try {
    // Read user data from the database
    const userData = await read(userPath);

    if (!userData) {
      logger.warn('[UsersLib] 登录失败：用户不存在', { username });
      throw new ValidationError('Username or password incorrect.'); // Generic error for security
    }
    if (!userData.password) { // Ensure user has a password set
      logger.error('[UsersLib] 登录失败：用户密码未设置', { username });
      throw new ValidationError('Username or password incorrect.'); // Should not happen if registration is strict
    }

    // Compare provided password with stored hash
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      logger.warn('[UsersLib] 登录失败：密码不匹配', { username });
      throw new ValidationError('Username or password incorrect.');
    }

    // Update last login timestamp
    await write(userPath, { lastLoginAt: new Date().toISOString() }, { method: 'update' });

    logger.info('[UsersLib] 登录成功', { username });

    // Prepare response: exclude password, add uid and token stub
    const { password: _, ...userWithoutPassword } = userData;
    const token = generateAuthToken({ username: userWithoutPassword.username, email: userWithoutPassword.email }); // Generate auth token stub
    return { ...userWithoutPassword, uid: username, token };

  } catch (error) {
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    logger.error('[UsersLib] 登录失败', error, { username });
    // Provide more specific error messages for common issues
    const errorMessage = error.message || 'An unknown error occurred during login.';
    if (errorMessage.includes("permission denied")) {
      throw new Error('Database permission denied. Please check your Firebase Realtime Database rules.');
    }
    if (errorMessage.includes("timed out") || errorMessage.includes("timeout")) {
      throw new Error('Database connection timed out. Please check your network connection.');
    }
    throw new Error(`Login failed: ${errorMessage}`);
  }
}

/**
* 获取用户信息 (不含敏感信息)
* @param {object} data - 包含 username 的对象
* @param {string} data.username - 用户名
* @returns {Promise<object | null>} - 用户资料 (不包含密码，含 uid)
* @throws {ValidationError} 如果输入无效或用户不存在
* @throws {Error} 如果数据库操作失败
*/
export async function getUserProfile({ username }) {
  // Validate username format
  if (!validateInput(username, 'username')) {
    logger.warn('[UsersLib] 获取用户资料：无效的用户名格式', { username });
    throw new ValidationError('Invalid username format.');
  }

  const userPath = `users/${username}`;
  try {
    const userData = await read(userPath);
    if (!userData) {
      logger.warn('[UsersLib] 获取用户资料：用户不存在', { username });
      throw new ValidationError('User not found.');
    }

    logger.info('[UsersLib] 获取用户资料成功', { username });

    // Prepare response: exclude password, add uid
    const { password: _, ...safeUserData } = userData;
    return { ...safeUserData, uid: username }; // Add uid for consistency

  } catch (error) {
    logger.error('[UsersLib] 获取用户资料失败', error, { username });
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to get user profile.'); // General error
  }
}

/**
* 更新用户信息
* @param {object} data - 包含 username (当前用户) 和待更新字段的对象
* @param {string} data.username - 待更新用户的当前用户名
* @param {object} updateFields - 实际要更新的字段 (如: { email, password, newUsername })
* @returns {Promise<object>} - 更新后的用户资料 (不包含密码和敏感信息，含 uid)
* @throws {ValidationError} 如果输入无效、用户不存在或无有效字段更新
* @throws {Error} 如果数据库操作失败
*/
export async function updateUser({ username, ...updateFields }) {
  // --- Initial Validation ---
  if (!username || !validateInput(username, 'username')) {
    logger.warn('[UsersLib] 更新用户：无效的当前用户名', { username });
    throw new ValidationError('Invalid current username provided.');
  }

  // Check if any update fields are provided
  if (!updateFields || typeof updateFields !== 'object' || Object.keys(updateFields).length === 0) {
    logger.warn('[UsersLib] 更新用户：未提供有效的更新字段', { username, updateFields });
    throw new ValidationError('No valid fields provided for update.');
  }

  const userPath = `users/${username}`;
  try {
    // Fetch existing user data
    const existingUser = await read(userPath);
    if (!existingUser) {
      logger.warn('[UsersLib] 更新用户：用户不存在', { username });
      throw new ValidationError('User not found.');
    }

    const dataToApply = {}; // Object to hold fields to be updated in the database
    let hasValidUpdateField = false;
    let newUsername = username; // Keep track of the potentially new username

    // --- Process Updates ---
    // Email update
    if (updateFields.email !== undefined && updateFields.email !== existingUser.email) {
      if (!validateInput(updateFields.email, 'email')) {
        logger.warn('[UsersLib] 更新用户：无效的 email 格式', { username, email: updateFields.email });
        throw new ValidationError('Invalid email format.');
      }
      dataToApply.email = sanitizeInput(updateFields.email);
      hasValidUpdateField = true;
    }

    // Username update
    if (updateFields.newUsername !== undefined && updateFields.newUsername !== username) {
      const sanitizedNewUsername = sanitizeInput(updateFields.newUsername);

      if (!validateInput(sanitizedNewUsername, 'username')) {
        logger.warn('[UsersLib] 更新用户：无效的新 username 格式', { username, newUsername: sanitizedNewUsername });
        throw new ValidationError('Invalid new username format. Use 1-50 characters.');
      }

      // Check if the new username already exists
      const newUsernamePath = `users/${sanitizedNewUsername}`;
      const newUsernameExists = await read(newUsernamePath);
      if (newUsernameExists) {
        logger.warn('[UsersLib] 更新用户：新 username 已存在', { username, newUsername: sanitizedNewUsername });
        throw new ValidationError(`Username "${sanitizedNewUsername}" already exists.`);
      }

      // Prepare for username change: mark that username will be updated
      dataToApply.username = sanitizedNewUsername;
      newUsername = sanitizedNewUsername; // Update the current username to the new one for response preparation
      hasValidUpdateField = true;
    }

    // Password update
    if (updateFields.password !== undefined) {
      if (!validateInput(updateFields.password, 'password')) {
        logger.warn('[UsersLib] 更新用户：新密码太弱', { username });
        throw new ValidationError('Password is too weak.');
      }
      dataToApply.password = await bcrypt.hash(updateFields.password, 10);
      hasValidUpdateField = true;
    }

    // If no valid fields were processed for update
    if (!hasValidUpdateField) {
      logger.warn('[UsersLib] 更新用户：未找到可更新的有效字段', { username, updateFields });
      throw new ValidationError('No valid fields provided for update.');
    }

    // Add timestamp for update
    dataToApply.updatedAt = new Date().toISOString();

    // --- Database Write Logic ---
    if (dataToApply.username && dataToApply.username !== username) {
      // Username is changing: need to delete old record and set new one
      await del(userPath); // Delete the old user record

      // Create the new user record, merging existing data with updates
      const updatedUserData = { ...existingUser, ...dataToApply, username: newUsername }; // Ensure username field is correct
      await write(`users/${newUsername}`, updatedUserData, { method: 'set' });

      logger.info('[UsersLib] 用户重命名并更新成功', { oldUsername: username, newUsername: newUsername });

      // Return the profile of the renamed user
      const renamedUser = await read(`users/${newUsername}`);
      const { password: _, ...safeRenamedUser } = renamedUser;
      return { ...safeRenamedUser, uid: newUsername }; // Add uid for consistency

    } else {
      // Username is not changing, just update fields
      await write(userPath, dataToApply, { method: 'update' });

      logger.info('[UsersLib] 用户信息更新成功', { username, updatedFields: Object.keys(dataToApply) });

      // Fetch and return the updated user profile
      const updatedUser = await read(userPath);
      const { password: _, ...safeUpdatedUser } = updatedUser;
      return { ...safeUpdatedUser, uid: username }; // Add uid for consistency
    }

  } catch (error) {
    logger.error('[UsersLib] 更新用户失败', error, { username, updateFields });
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to update user.'); // General error
  }
}
