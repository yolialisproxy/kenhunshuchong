// api/index.js
import { submitComment, getComments, deleteComment, editComment } from '../lib/comments.js';
import { registerUserHandler, loginUserHandler } from '../lib/user.js';
import { likeComment } from '../lib/like.js';
import { parseBody, setCORS, validateInput, logger } from '../lib/utils.js';
import Sentry from '@sentry/node';

console.log('✅ api/index.js加载模块成功');

Sentry.init({ dsn: process.env.SENTRY_DSN });

export async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    req.body = await parseBody(req);
    const action = req.query.action;

    if (req.method === 'POST' && action === 'register') return await registerUserHandler(req, res);
    if (req.method === 'POST' && action === 'login') return await loginUserHandler(req, res);
    if (req.method === 'POST' && action === 'like') {
      const { postId, commentId } = req.body;
      if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
        logger.error('点赞失败：无效参数', { postId, commentId });
        return res.status(400).json({ success: false, message: '无效的 postId 或 commentId' });
      }
      try {
        const result = await likeComment(postId, commentId);
        return res.status(200).json({ success: true, ...result });
      } catch (error) {
        Sentry.captureException(error);
        logger.error('点赞错误', { error: error.message, stack: error.stack });
        if (error.isGhostLike) return res.status(410).json({ success: false, message: '评论不存在', ghostLike: true });
        return res.status(500).json({ success: false, message: '点赞失败，请稍后重试', details: error.message });
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
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error('服务器错误', { error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: '服务器错误，请稍后重试', details: err.message });
  }
};
