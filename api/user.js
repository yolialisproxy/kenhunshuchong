// api/user.js
import { registerUser, loginUser, getUser } from '../lib/user.js';
import { setCORS, handleError } from '../lib/utils.js';

export default async function handler(req, res) {
  setCORS(res);

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    switch (req.method) {
      case 'POST':
        // 根据请求体决定是注册还是登录
        if (req.body.email) {
          // 注册
          const user = await registerUser(req.body);
          return res.status(201).json({
            success: true,
            data: user
          });
        } else {
          // 登录
          const user = await loginUser(req.body);
          return res.status(200).json({
            success: true,
            data: user
          });
        }

      case 'GET':
        const { username } = req.query;
        if (!username) {
          return res.status(400).json({
            success: false,
            error: '缺少用户名'
          });
        }

        const user = await getUser(username);
        return res.status(200).json({
          success: true,
          data: user
        });

      default:
        return res.status(405).json({
          success: false,
          error: '方法不允许'
        });
    }
  } catch (error) {
    return handleError(error, res);
  }
}
