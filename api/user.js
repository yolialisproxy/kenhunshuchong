// api/user.js
const path = require('path');
const { initFirebase, ref, set, get, parseBody, setCORS, withTimeout, bcrypt, validateInput, CONFIG, logger, sanitizeInput } = require(path.resolve(__dirname, '../lib/utils.js'));
const jwt = require('jsonwebtoken');

console.log('✅ api/user.js加载utils.js成功');

export async function registerUserHandler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    logger.error('解析请求体失败', { error: err.message, stack: err.stack });
    return res.status(400).json({ error: '无效的请求体' });
  }

  const { username, email, password } = body;

  if (!validateInput(username, 'username') || !validateInput(email, 'email') || !validateInput(password, 'password')) {
    logger.error('注册失败：无效参数', { username, email });
    return res.status(400).json({ error: '无效的用户名、邮箱或密码' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const userRef = ref(initFirebase(), `users/${username}`);
      const snapshot = await withTimeout(get(userRef), CONFIG.TIMEOUT);
      if (snapshot.exists()) {
        logger.warn('用户名已存在', { username });
        return res.status(409).json({ error: '用户名已存在' });
      }

      const hashedPassword = await bcrypt.hash(sanitizeInput(password), 10);
      await withTimeout(set(userRef, { username: sanitizeInput(username), email: sanitizeInput(email), password: hashedPassword, createdAt: Date.now() }), CONFIG.TIMEOUT);
      const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
      return res.status(200).json({ message: '注册成功', user: { username, email }, token });
    } catch (err) {
      attempt++;
      logger.error(`注册用户尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(500).json({ error: '注册失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

export async function loginUserHandler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    logger.error('解析请求体失败', { error: err.message, stack: err.stack });
    return res.status(400).json({ error: '无效的请求体' });
  }

  const { username, password } = body;

  if (!validateInput(username, 'username') || !validateInput(password, 'password')) {
    logger.error('登录失败：无效参数', { username });
    return res.status(400).json({ error: '无效的用户名或密码' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const userRef = ref(initFirebase(), `users/${username}`);
      const snapshot = await withTimeout(get(userRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        logger.warn('用户不存在', { username });
        return res.status(404).json({ error: '用户不存在' });
      }

      const userData = snapshot.val();
      const match = await bcrypt.compare(sanitizeInput(password), userData.password);
      if (!match) {
        logger.warn('密码错误', { username });
        return res.status(401).json({ error: '密码错误' });
      }

      const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
      return res.status(200).json({ message: '登录成功', user: { username: userData.username, email: userData.email }, token });
    } catch (err) {
      attempt++;
      logger.error(`登录用户尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(500).json({ error: '登录失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

export async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    req.body = await parseBody(req);
    const action = req.query.action;

    if (req.method === 'POST' && action === 'register') return await registerUserHandler(req, res);
    if (req.method === 'POST' && action === 'login') return await loginUserHandler(req, res);
  } catch (err) {
    Sentry.captureException(err);
    logger.error('服务器错误', { error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: '服务器错误，请稍后重试', details: err.message });
  }
};
