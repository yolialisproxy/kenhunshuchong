// api/user.js
import { registerUser, loginUser } from '../lib/user.js';
import { parseBody, setCORS } from '../lib/utils.js';

export default async function handler(req, res) {
  // 设置CORS
  setCORS(res);

  try {
    // 只处理POST请求
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: '方法不允许' });
    }

    // 解析请求体
    const body = await parseBody(req);
    const { action, username, password } = body;

    if (!action || !username || !password) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    let result;
    if (action === 'register') {
      result = await registerUser(username, password);
    } else if (action === 'login') {
      result = await loginUser(username, password);
    } else {
      return res.status(400).json({ success: false, error: '无效的操作' });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('用户API错误:', error);
    return res.status(500).json({ success: false, error: error.message || '服务器错误' });
  }
}
