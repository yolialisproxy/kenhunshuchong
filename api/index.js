// api/index.js
import { setCORS } from '../lib/utils.js';

export default function handler(req, res) {
  setCORS(res);

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.status(200).json({
    success: true,
    message: 'API服务运行正常',
    version: '1.0.0',
    endpoints: {
      comments: '/api/comments',
      likes: '/api/likes',
      users: '/api/user'
    }
  });
}
