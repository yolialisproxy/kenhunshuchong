import { submitComment, getComments, deleteComment, editComment } from '../lib/comments.js';
import { registerUserHandler, loginUserHandler } from '../lib/user.js';
import { likeComment } from '../lib/like.js';
import { parseBody, setCORS } from '../lib/utils.js';
console.log('✅ api/index.js导入lib/模块成功');

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

    if (req.method === 'POST' && action === 'like') {
      const { postId, commentId } = req.body;
      if (!postId || !commentId) {
        return res.status(400).json({ success: false, message: '缺少 postId 或 commentId' });
      }
      try {
        const totalLikes = await likeComment(postId, commentId);
        return res.status(200).json({ success: true, totalLikes });
      } catch (error) {
        console.error('❌ api/index.js点赞错误:', error);
        if (error.isGhostLike) {
          return res.status(410).json({ success: false, message: '评论不存在', ghostLike: true });
        }
        return res.status(500).json({ success: false, message: '点赞失败', details: error.message });
      }
    }

    switch (req.method) {
      case 'POST':
        return await submitComment(req, res);
      case 'GET':
        return await getComments(req, res);
      case 'DELETE':
        return await deleteComment(req, res);
      case 'PUT':
        return await editComment(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('❌ api/index.js 服务器错误:', err);
    return res.status(500).json({ error: '服务器错误', details: err.message });
  }
}
