// lib/user.js
import { db, validateInput, hashPassword, verifyPassword } from './utils.js';

// 用户注册
export async function registerUser(userData) {
  // 验证输入
  const validationErrors = validateInput(userData, ['username', 'password', 'email']);
  if (validationErrors) {
    const error = new Error('输入验证失败');
    error.name = 'ValidationError';
    error.message = validationErrors.join(', ');
    throw error;
  }

  try {
    // 检查用户名是否已存在
    const existingUser = await db.get(`users/${userData.username}`);
    if (existingUser) {
      const error = new Error('用户名已存在');
      error.name = 'ValidationError';
      throw error;
    }

    // 加密密码
    const hashedPassword = await hashPassword(userData.password);

    // 创建用户
    const newUser = {
      username: userData.username,
      email: userData.email,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      role: 'user'
    };

    await db.set(`users/${userData.username}`, newUser);

    // 返回用户信息（不包含密码）
    const { password, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  } catch (error) {
    console.error('用户注册失败:', error);
    throw error;
  }
}

// 用户登录
export async function loginUser(credentials) {
  // 验证输入
  const validationErrors = validateInput(credentials, ['username', 'password']);
  if (validationErrors) {
    const error = new Error('输入验证失败');
    error.name = 'ValidationError';
    error.message = validationErrors.join(', ');
    throw error;
  }

  try {
    // 获取用户
    const user = await db.get(`users/${credentials.username}`);
    if (!user) {
      const error = new Error('用户名或密码错误');
      error.name = 'ValidationError';
      throw error;
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(credentials.password, user.password);
    if (!isPasswordValid) {
      const error = new Error('用户名或密码错误');
      error.name = 'ValidationError';
      throw error;
    }

    // 返回用户信息（不包含密码）
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  } catch (error) {
    console.error('用户登录失败:', error);
    throw error;
  }
}

// 获取用户信息
export async function getUser(username) {
  try {
    const user = await db.get(`users/${username}`);
    if (!user) {
      const error = new Error('用户不存在');
      error.name = 'ValidationError';
      throw error;
    }

    // 返回用户信息（不包含密码）
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    throw error;
  }
}
