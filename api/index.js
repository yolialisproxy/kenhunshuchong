// api/index.js (修正版本 - 中心调度器)

// 假设这些 lib 文件导出了具体的操作函数，而非一个总的 handler
import * as commentsLib from '../lib/comments';
import * as likesLib from '../lib/likes';
import * as usersLib from '../lib/users';
import { setCORS, parseBody, logger, ValidationError } from '../lib/utils.js';

export default async function handler(req, res) {
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

    // 验证 req 和 res
  if (!req || !res) {
    logger.error('缺少 req 或 res 参数', { req: !!req, res: !!res });
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid request context' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
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

  const { type, action, ...data } = body; // 解构出 type, action 和其余数据

  // 验证基本参数
  if (!type || !action) {
    logger.warn('缺少必要参数', { type, action});
    return new Response(
      JSON.stringify({ success: false, message: 'Missing required parameters' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let result;
    switch (type) {
      case 'comment':
        switch (action) {
          case 'get':
            if (req.method !== 'GET') throw new Error('Method not allowed for get comments');
            result = await commentsLib.getComments(data); // 假设 lib/comments.js 导出 getComments 函数
            break;
          case 'add':
            if (req.method !== 'POST') throw new Error('Method not allowed for add comment');
            result = await commentsLib.addComment(data); // 假设 lib/comments.js 导出 addComment 函数
            break;
          case 'update':
            if (req.method !== 'PUT') throw new Error('Method not allowed for update comment');
            result = await commentsLib.updateComment(data); // 假设 lib/comments.js 导出 updateComment 函数
            break;
          case 'delete':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for delete comment');
            result = await commentsLib.deleteComment(data); // 假设 lib/comments.js 导出 deleteComment 函数
            break;
          default:
            throw new Error(`Unknown action "${action}" for comment type`);
        }
        break;

      case 'like':
        switch (action) {
          case 'add_comment_like':
            if (req.method !== 'POST') throw new Error('Method not allowed for addCommentLike');
            result = await likesLib.addCommentLike(data);
            break;
          case 'remove_comment_like':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for removeCommentLike');
            result = await likesLib.removeCommentLike(data);
            break;
          case 'get_direct_count':
            if (req.method !== 'GET') throw new Error('Method not allowed for getCommentDirectLikesCount');
            result = await likesLib.getCommentDirectLikesCount(data);
            break;
          case 'get_total_count':
            if (req.method !== 'GET') throw new Error('Method not allowed for getCommentTotalLikesCount');
            result = await likesLib.getCommentTotalLikesCount(data);
            break;
          case 'has_liked':
            if (req.method !== 'POST') throw new Error('Method not allowed for hasUserLikedComment');
            result = await likesLib.hasUserLikedComment(data);
            break;
          case 'add_article_like':
            if (req.method !== 'POST') throw new Error('Method not allowed for addArticleLike');
            result = await likesLib.addArticleLike(data);
            break;
          case 'remove_article_like':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for removeArticleLike');
            result = await likesLib.removeArticleLike(data);
            break;
          case 'get_article_count':
            if (req.method !== 'GET') throw new Error('Method not allowed for getArticleLikesCount');
            result = await likesLib.getArticleLikesCount(data);
            break;
          case 'has_article_liked':
            if (req.method !== 'POST') throw new Error('Method not allowed for hasUserLikedArticle');
            result = await likesLib.hasUserLikedArticle(data);
            break;
          default:
            throw new Error(`Unknown action "${action}" for like type`);
        }
        break;

      case 'user':
        switch (action) {
          case 'register':
            if (req.method !== 'POST') throw new Error('Method not allowed for registerUser');
            result = await usersLib.registerUser(data);
            break;
          case 'login':
            if (req.method !== 'POST') throw new Error('Method not allowed for loginUser');
            result = await usersLib.loginUser(data);
            break;
          case 'getProfile':
            if (req.method !== 'GET') throw new Error('Method not allowed for getUserProfile');
            result = await usersLib.getUserProfile(data);
            break;
          case 'update':
            if (req.method !== 'PUT') throw new Error('Method not allowed for updateUser');
            result = await usersLib.updateUser(data);
            break;
          case 'delete':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for deleteUser');
            result = await usersLib.deleteUser(data);
            break;
          // ... 更多用户相关操作
          default:
            throw new Error(`Unknown action "${action}" for user type`);
        }
        break;

      default:
        throw new Error(`Unknown request type: ${type}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logger.error('[API Index] API 处理失败', { error: error.message, stack: error.stack, body, method: req.method, type, action });
    const statusCode = error.status || 500;
    const errorMessage = error.message || 'Server error';
    return new Response(
      JSON.stringify({ success: false, message: errorMessage }),
      { status: statusCode, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
