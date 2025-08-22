// api/index.js
import { setCORS } from '../lib/utils.js';

export default async function handler(req, res) {
  // 设置CORS
  setCORS(res);

  // 返回API信息
  return res.status(200).json({
    success: true,
    message: '欢迎使用博客API',
    version: '1.0.0',
    endpoints: {
      comments: '/api/comments',
      likes: '/api/likes',
      user: '/api/user'
    }
  });
}
