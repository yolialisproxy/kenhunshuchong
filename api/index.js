// api/index.js - 修复版：使用 lib/users.js 的正确导出

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
import { addComment, getComments, updateComment, removeComment } from '../lib/comments.js';
import { registerUser, updateUser, deleteUser, getUserProfile } from '../lib/users.js';

console.log('✅ api/index.js加载成功');

// 主 API 处理函数（默认导出，明确声明 req 和 res 参数）
export default async function handler(req, res) {
  // 验证 req 和 res
  if (!req || !res) {
    logger.error('缺少 req 或 res 参数', { req: !!req, res: !!res });
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid request context' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 设置 CORS 头
  try {
    setCORS(res, req);
  } catch (error) {
    logger.error('设置 CORS 失败', error);
    return new Response(
      JSON.stringify({ success: false, message: 'CORS setup failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

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

  const { type, action, username, postId, commentId, adminId, data, userData, commentData, content } = body;

  // 验证基本参数
  if (!type || !action || !username || !postId) {
    logger.warn('缺少必要参数', { type, action, username, postId });
    return new Response(
      JSON.stringify({ success: false, message: 'Missing required parameters' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let result;
    switch (type) {
      case 'articleLike':
        switch (action) {
          case 'add_like':
            result = await addArticleLike(username, postId);
            break;
          case 'remove_like':
            result = await removeArticleLike(username, postId);
            break;
          case 'get_count':
            result = await getArticleLikesCount(postId);
            break;
          case 'has_liked':
            result = await hasUserLikedArticle(username, postId);
            break;
          default:
            throw new ValidationError(`Unsupported action: ${action}`);
        }
        break;
      case 'commentLike':
        switch (action) {
          case 'add_like':
            result = await addCommentLike(username, postId, commentId);
            break;
          case 'remove_like':
            result = await removeCommentLike(username, postId, commentId);
            break;
          case 'get_direct_count':
            result = await getCommentDirectLikesCount(postId, commentId);
            break;
          case 'get_total_count':
            result = await getCommentTotalLikesCount(postId, commentId);
            break;
          case 'has_liked':
            result = await hasUserLikedComment(username, postId, commentId);
            break;
        }
      case 'comment':
        switch (action) {
          case 'add':
            result = await addComment(commentData);
            break;
          case 'get':
            result = await getComments(postId);
            break;
          case 'update':
            result = await updateComment(postId, commentId, content, username);
            break;
          case 'delete':
            result = await removeComment(username, postId, commentId, adminId);
            break;
          default:
            throw new ValidationError(`Unsupported action: ${action}`);
        }
        break;
      case 'user':
        switch (action) {
          case 'register':
            result = await registerUser(userData);
            break;
          case 'get':
            result = await getUserProfile(username);
            break;
          case 'update':
            result = await updateUser(username, data);
            break;
          case 'delete':
            result = await deleteUser(username);
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
    logger.error(`API处理失败 (type: ${type}, action: ${action})`, error, { username, postId, commentId });
    const status = error.name === 'ValidationError' ? 400 : 500;
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Server error';
    return new Response(
      JSON.stringify({ success: false, message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
