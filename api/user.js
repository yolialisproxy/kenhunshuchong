const { initFirebase, ref, set, get, parseBody, setCORS, withTimeout, bcrypt, validateInput, CONFIG } = require('../lib/utils.js');
console.log('✅ api/user.js加载utils.js成功');

async function registerUserHandler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error('❌ 解析请求体失败:', err.stack);
    return res.status(400).json({ error: '无效的请求体' });
  }

  const { username, email, password } = body;

  if (!validateInput(username, 'username') || !validateInput(email, 'email') || !validateInput(password, 'password')) {
    return res.status(400).json({ error: '无效的用户名、邮箱或密码' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const userRef = ref(initFirebase(), `users/${username}`);
      const snapshot = await withTimeout(get(userRef), CONFIG.TIMEOUT);
      if (snapshot.exists()) {
        return res.status(409).json({ error: '用户名已存在' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await withTimeout(set(userRef, { username, email, password: hashedPassword, createdAt: Date.now() }), CONFIG.TIMEOUT);
      return res.status(200).json({ message: '注册成功', user: { username, email } });
    } catch (err) {
      attempt++;
      console.error(`❌ 注册用户尝试${attempt}失败:`, err.stack);
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(500).json({ error: '注册失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

async function loginUserHandler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error('❌ 解析请求体失败:', err.stack);
    return res.status(400).json({ error: '无效的请求体' });
  }

  const { username, password } = body;

  if (!validateInput(username, 'username') || !validateInput(password, 'password')) {
    return res.status(400).json({ error: '无效的用户名或密码' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const userRef = ref(initFirebase(), `users/${username}`);
      const snapshot = await withTimeout(get(userRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        return res.status(404).json({ error: '用户不存在' });
      }

      const userData = snapshot.val();
      const match = await bcrypt.compare(password, userData.password);
      if (!match) {
        return res.status(401).json({ error: '密码错误' });
      }

      return res.status(200).json({ message: '登录成功', user: { username: userData.username, email: userData.email } });
    } catch (err) {
      attempt++;
      console.error(`❌ 登录用户尝试${attempt}失败:`, err.stack);
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(500).json({ error: '登录失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

module.exports = { registerUserHandler, loginUserHandler };
