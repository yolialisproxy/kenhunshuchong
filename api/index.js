// api/index.js (修正版本 - 中心调度器，适配 Vercel Serverless Functions)
// 假设这些 lib 文件导出了具体的操作函数，而非一个总的 handler
import * as commentsLib from '../lib/comments.js';
import * as likesLib from '../lib/likes.js';
import * as usersLib from '../lib/users.js';
import { setCORS , parseBody, logger, ValidationError } from '../lib/utils.js'; // Import setCORS from utils

// --- Handler Function Signature ---
// Vercel Serverless Functions typically receive only `req` and should return a `Response`.
// `res` object is not directly available or used in the same way as in Express.
export default async function handler(req, res) {
  res.setCORS(res);

  // --- Handle OPTIONS (Preflight) Requests ---
  if (req.method === 'OPTIONS') {
    // For preflight requests, return 204 No Content with CORS headers
    logger.info('收到 OPTIONS 请求，返回 204 No Content');
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // --- Parse Request Body ---
  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    logger.error('解析请求体失败', error);
    // Return 400 Bad Request if body parsing fails
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid request body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // --- Extract Core Request Parameters ---
  const { type, action } = body;

  // --- Validate Essential Parameters ---
  if (!type || !action) {
    logger.warn('缺少必要的请求参数 (type, action)', { type, action });
    // Return 400 Bad Request if type or action is missing
    return new Response(
      JSON.stringify({ success: false, message: 'Missing required parameters: type and action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // --- Route Request to Appropriate Lib Function ---
  try {
    let result; // Variable to hold the result of the business logic function

    // --- Main Routing Logic based on 'type' ---
    switch (type) {
      case 'comment':
        // Route comments-related requests
        switch (action) {
          case 'get':
            result = await commentsLib.getComments(body);
          case 'add':
            result = await commentsLib.addComment(body);
          case 'update':
            result = await commentsLib.updateComment(body);
          case 'delete':
            result = await commentsLib.deleteComment(body);
          default:
            throw new Error(`Unknown action "${action}" for type "comment"`);
        }
        break;

      case 'like':
        // Route likes-related requests
        switch (action) {
          case 'add_comment_like':
            result = await likesLib.addCommentLike(body);
          case 'remove_comment_like':
            result = await likesLib.removeCommentLike(body);
          case 'get_direct_count':
            result = await likesLib.getCommentDirectLikesCount(body);
          case 'get_total_count':
            result = await likesLib.getCommentTotalLikesCount(body);
          case 'has_liked': // Check if user liked a comment
            result = await likesLib.hasUserLikedComment(body);
          case 'add_article_like':
            result = await likesLib.addArticleLike(body);
          case 'remove_article_like':
            result = await likesLib.removeArticleLike(body);
          case 'get_article_count':
            result = await likesLib.getArticleLikesCount(body);
          case 'has_article_liked': // Check if user liked an article
            result = await likesLib.hasUserLikedArticle(body);
          default:
            throw new Error(`Unknown action "${action}" for type "like"`);
        }
        break;

      case 'user':
        // Route user-related requests
        switch (action) {
          case 'register':
            result = await usersLib.registerUser(body);
          case 'login':
            result = await usersLib.loginUser(body);
          case 'getProfile':
            result = await usersLib.getUserProfile(body);
          case 'update':
            result = await usersLib.updateUser(body);
          case 'delete':
            result = await usersLib.deleteUser(body);
          // Add more user actions here if needed
          default:
            throw new Error(`Unknown action "${action}" for type "user"`);
        }
        break;

      default:
        // Handle unknown request types
        throw new Error(`Unknown request type: "${type}"`);
    }

    // --- Success Response ---
    // Return a 200 OK response with the result data
    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // --- Error Handling ---
    // Log the error details
    logger.error('[API Index] API 处理失败', { error: error.message, stack: error.stack, body, method: req.method, type, action });

    // Determine status code: use error.status if available, otherwise default to 500
    const statusCode = error.status || 500;
    // Extract error message, providing a default for unexpected errors
    const errorMessage = error.message || 'An unexpected server error occurred.';

    // Return an error response
    return new Response(
      JSON.stringify({ success: false, message: errorMessage }),
      { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
