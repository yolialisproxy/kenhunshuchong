// api/index.js - Vercel Serverless Function Entry Point
import { logger, parseBody, setCORS, ValidationError } from '../lib/utils.js';
import {
  addComment, getComments, updateComment, deleteComment,
  getCommentById, getCommentTree, computeCommentTreeTotalLikes, updateCommentAncestorsTotalLikes
} from '../lib/comments.js';
import {
  addArticleLike, removeArticleLike, getArticleLikesCount, hasUserLikedArticle,
  addCommentLike, removeCommentLike, getCommentDirectLikesCount, getCommentTotalLikesCount, hasUserLikedComment
} from '../lib/likes.js';
import {
  registerUser, loginUser, logoutUser, getUserProfile, updateUser, deleteUser
} from '../lib/users.js';

logger.info('🚀 Vercel API /api/index.js 加载成功');

export default async function handler(req, res) {
  setCORS(res); // 设置 CORS 头部，允许跨域请求

  // 处理 OPTIONS 方法，用于 CORS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let requestData;
  try {
    // 使用 parseBody 函数统一解析所有请求的参数
    // 对于 GET 请求，它会解析 URL 查询参数
    // 对于 POST/PUT/DELETE 请求，它会解析请求体
    requestData = await parseBody(req);
    logger.debug(`[API Handler] Request received: Method=${req.method}, Path=${req.url}, ParsedData=`, requestData);
  } catch (error) {
    logger.error('[API Handler] Error parsing request body/params:', error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Invalid request format or body.' }));
    return;
  }

  const { type, action, ...params } = requestData;

  // 基础验证：确保 type 和 action 参数存在
  if (!type || !action) {
    logger.warn(`[API Handler] Missing required parameters: type or action. Received data:`, requestData);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Missing required parameters: type and action' }));
    return;
  }

  try {
    let result;
    switch (type) {
      case 'comment':
        switch (action) {
          case 'add':
            result = await addComment(params);
            break;
          case 'get':
            result = await getComments(params.queryParams);
            break;
          case 'update':
            result = await updateComment(params);
            break;
          case 'delete':
            result = await deleteComment(params);
            break;
          case 'getTree':
            result = await getCommentTree(params);
            break;
          case 'computeTotalLikes':
            result = await computeCommentTreeTotalLikes(params);
            break;
          case 'updateAncestorsLikes':
            result = await updateCommentAncestorsTotalLikes(params);
            break;
          default:
            throw new ValidationError(`Unsupported comment action: ${action}`);
        }
        break;

      case 'like':
        switch (action) {
          case 'addArticleLike':
            result = await addArticleLike(params);
            break;
          case 'removeArticleLike':
            result = await removeArticleLike(params);
            break;
          case 'getArticleLikesCount':
            result = await getArticleLikesCount(params);
            break;
          case 'hasUserLikedArticle':
            result = await hasUserLikedArticle(params);
            break;
          case 'addCommentLike':
            result = await addCommentLike(params);
            break;
          case 'removeCommentLike':
            result = await removeCommentLike(params);
            break;
          case 'getCommentDirectLikesCount':
            result = await getCommentDirectLikesCount(params);
            break;
          case 'getCommentTotalLikesCount':
            result = await getCommentTotalLikesCount(params);
            break;
          case 'hasUserLikedComment':
            result = await hasUserLikedComment(params);
            break;
          default:
            throw new ValidationError(`Unsupported like action: ${action}`);
        }
        break;

      case 'user':
        switch (action) {
          case 'register':
            result = await registerUser(params);
            break;
          case 'login':
            result = await loginUser(params);
            break;
          case 'logout':
            result = await logoutUser(params);
            break;
          case 'profile':
            result = await getUserProfile(params);
            break;
          case 'update':
            result = await updateUser(params);
            break;
          case 'delete':
            result = await deleteUser(params);
            break;
          default:
            throw new ValidationError(`Unsupported user action: ${action}`);
        }
        break;

      default:
        throw new ValidationError(`Unsupported API type: ${type}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: result }));

  } catch (error) {
    // --- Error Handling ---
    // Log the error details
    logger.error('[API Index] API 处理失败', { error: error.message, stack: error.stack, body, method: req.method, type, action });

    // Determine status code: use error.status if available, otherwise default to 500
    const statusCode = error.status || 500;
    // Extract error message, providing a default for unexpected errors
    const errorMessage = error.message || 'An unexpected server error occurred.';

    // Return an error response
    return  res.status(statusCode).json({ success: false, message: errorMessage });
  }
}
