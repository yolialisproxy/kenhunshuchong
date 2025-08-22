// api/index.js - 修复版：确保 handler 函数签名正确，适配 Vercel API 路由

import { setCORS, parseBody, logger, ValidationError } from '../lib/utils.js';
import {
  addCommentLike,
  removeCommentLike,
  getCommentDirectLikesCount,
  getCommentTotalLikesCount,
  hasUserLikedComment,
  addArticleLike,
  removeArticleLike,
  getArticleLikesCount,
  hasUserLikedArticle
} from '../lib/likes.js';
import { addComment, getComments, updateComment, deleteComment } from '../lib/comments.js';
import { addUser, updateUser, deleteUser, getUser } from '../lib/users.js';

console.log('✅ api/index.js加载成功');

// 主 API 处理函数（默认导出，明确声明 req 和 res 参数）
export default async function handler(req, res) {
  // 设置 CORS 头以支持跨域请求
  setCORS(res, req);

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // 验证请求方法
  if (req.method !== 'POST') {
    logger.warn('不支持的请求方法', { method: req.method });
    return new Response(
      JSON.stringify({ success: false, message: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 解析请求体
  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    logger.error('解析请求体失败', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { type, action, userId, postId, commentId, data } = body;

  // 验证基本参数
  if (!type || !action || !userId || !postId) {
    logger.warn('缺少必要参数', { type, action, userId, postId });
    return new Response(
      JSON.stringify({ success: false, message: 'Missing required parameters' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let result;
    switch (type) {
      case 'article':
        switch (action) {
          case 'add_like':
            result = await addArticleLike(userId, postId);
            break;
          case 'remove_like':
            result = await removeArticleLike(userId, postId);
            break;
          case 'get_count':
            result = await getArticleLikesCount(postId);
            break;
          case 'has_liked':
            result = await hasUserLikedArticle(userId, postId);
            break;
          default:
            throw new ValidationError(`Unsupported action: ${action}`);
        }
        break;
      case 'comment':
        switch (action) {
          case 'add_like':
            result = await addCommentLike(userId, postId, commentId);
            break;
          case 'remove_like':
            result = await removeCommentLike(userId, postId, commentId);
            break;
          case 'get_direct_count':
            result = await getCommentDirectLikesCount(postId, commentId);
            break;
          case 'get_total_count':
            result = await getCommentTotalLikesCount(postId, commentId);
            break;
          case 'has_liked':
            result = await hasUserLikedComment(userId, postId, commentId);
            break;
          case 'add':
            result = await addComment(userId, postId, data);
            break;
          case 'get':
            result = await getComments(postId);
            break;
          case 'update':
            result = await updateComment(userId, postId, commentId, data);
            break;
          case 'delete':
            result = await deleteComment(userId, postId, commentId);
            break;
          default:
            throw new ValidationError(`Unsupported action: ${action}`);
        }
        break;
      case 'user':
        switch (action) {
          case 'add':
            result = await addUser(userId, data);
            break;
          case 'get':
            result = await getUser(userId);
            break;
          case 'update':
            result = await updateUser(userId, data);
            break;
          case 'delete':
            result = await deleteUser(userId);
            break;
          default:
            throw new ValidationError(`Unsupported action: ${action}`);
        }
        break;
      default:
        throw new ValidationError(`Unsupported type: ${type}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error(`API处理失败 (type: ${type}, action: ${action})`, error, { userId, postId, commentId });
    const status = error.name === 'ValidationError' ? 400 : 500;
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Server error';
    return new Response(
      JSON.stringify({ success: false, message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
