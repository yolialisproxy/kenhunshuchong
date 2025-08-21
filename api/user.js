import { initFirebase, ref, set, get, parseBody, setCORS, withTimeout } from '../lib/utils.js';
import bcrypt from 'bcryptjs';
console.log('✅ lib/user.js导入lib/utils.js成功');

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
    const userRef = ref(initFirebase(), `users/${username}`);
    const snapshot = await withTimeout(get(userRef));

    if (snapshot.exists()) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await withTimeout(set(userRef, {
      username,
      email,
      password: hashedPassword,
      createdAt: Date.now()
    }));

    return res.status(200).json({ message: '注册成功' });
  } catch (err) {
    console.error('❌ 注册用户错误:', err);
    return res.status(500).json({ error: '注册失败', details: err.message });
  }
}

export async function loginUserHandler(req, res) {
  setCORS(res);
  req.body = await parseBody(req);
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '缺少用户名或密码' });
  }

  try {
    const userRef = ref(initFirebase(), `users/${username}`);
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
      user: { username: userData.username, email: userData.email }
    });
  } catch (err) {
    console.error('❌ 登录用户错误:', err);
    return res.status(500).json({ error: '登录失败', details: err.message });
  }
}

export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    req.body = await parseBody(req);
    const action = req.query.action;

    if (req.method === 'POST' && action === 'register') {
      return await registerUserHandler(req, res);
    }
    if (req.method === 'POST' && action === 'login') {
      return await loginUserHandler(req, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('❌ api/user.js 服务器错误:', err);
    return res.status(500).json({ error: '服务器错误', details: err.message });
  }
}
