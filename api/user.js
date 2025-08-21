try {
  import { db, ref, set, get, parseBody, setCORS, withTimeout } from './utils.js';
  import bcrypt from 'bcryptjs';
  console.log('✅ user.js加载并导入utils.js成功');
} catch (err) {
  console.error('❌ user.js导入utils.js失败:', err);
  throw err;
}

export async function registerUserHandler(req, res) {
  setCORS(res);
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: '缺少用户名、邮箱或密码' });
  }

  if (password.length < 8 || !/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
    return res.status(400).json({ error: '密码太弱，至少8位含数字和字母' });
  }

  try {
    const userRef = ref(db(), `users/${username}`);
    const snapshot = await withTimeout(get(userRef));

    if (snapshot.exists()) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await withTimeout(set(userRef, {
      username,
      email,
      password: hashedPassword,
      createdAt: Date.now(),
    }));

    return res.status(200).json({ message: '注册成功' });
  } catch (err) {
    console.error('❌ 注册用户错误:', err);
    return res.status(500).json({ error: '注册失败', details: err.message });
  }
}

export async function loginUserHandler(req, res) {
  setCORS(res);
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '缺少用户名或密码' });
  }

  try {
    const userRef = ref(db(), `users/${username}`);
    const snapshot = await withTimeout(get(userRef));

    if (!snapshot.exists()) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const userData = snapshot.val();
    const match = await bcrypt.compare(password, userData.password);

    if (!match) {
      return res.status(401).json({ error: '密码错误' });
    }

    return res.status(200).json({
      message: '登录成功',
      user: { username: userData.username, email: userData.email },
    });
  } catch (err) {
    console.error('❌ 登录用户错误:', err);
    return res.status(500).json({ error: '登录失败', details: err.message });
  }
}
