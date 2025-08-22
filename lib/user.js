// lib/user.js
import { ref, push, set, get, child } from 'firebase/database';
import { database, bcrypt } from './utils.js';

// 用户注册
export async function registerUser(username, password) {
  try {
    // 检查用户名是否已存在
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);
    if (snapshot.exists()) {
      const users = snapshot.val();
      for (const key in users) {
        if (users[key].username === username) {
          throw new Error('用户名已存在');
        }
      }
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户
    const newUserRef = push(usersRef);
    await set(newUserRef, {
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    });

    return { success: true, userId: newUserRef.key };
  } catch (error) {
    throw error;
  }
}

// 用户登录
export async function loginUser(username, password) {
  try {
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);
    if (!snapshot.exists()) {
      throw new Error('用户不存在');
    }

    let userFound = false;
    let userData = null;
    let userId = null;

    snapshot.forEach((childSnapshot) => {
      const user = childSnapshot.val();
      if (user.username === username) {
        userFound = true;
        userData = user;
        userId = childSnapshot.key;
      }
    });

    if (!userFound) {
      throw new Error('用户不存在');
    }

    // 验证密码
    const passwordMatch = await bcrypt.compare(password, userData.password);
    if (!passwordMatch) {
      throw new Error('密码错误');
    }

    // 返回用户信息（不包含密码）
    const { password: _, ...userWithoutPassword } = userData;
    return { success: true, user: { ...userWithoutPassword, id: userId } };
  } catch (error) {
    throw error;
  }
}
