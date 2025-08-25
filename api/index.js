// api/index.js (修正版本 - 中心调度器，适配 Vercel Serverless Functions)
// 假设这些 lib 文件导出了具体的操作函数，而非一个总的 handler
import * as commentsLib from '../lib/comments.js';
import * as likesLib from '../lib/likes.js';
import * as usersLib from '../lib/users.js';
import { setCORS as utilsSetCORS, parseBody, logger, ValidationError } from '../lib/utils.js'; // Import setCORS from utils

// --- Handler Function Signature ---
// Vercel Serverless Functions typically receive only `req` and should return a `Response`.
// `res` object is not directly available or used in the same way as in Express.
export default async function handler(req) {
  // --- CORS Setup ---
  // Set CORS headers dynamically based on the incoming request's origin.
  // Note: Vercel's serverless functions handle CORS preflight (OPTIONS) differently.
  // We'll ensure CORS headers are applied to the actual response.
  const corsHeaders = utilsSetCORS(req); // Call setCORS with the request to get CORS headers

  // --- Basic Request Validation ---
  if (!req) {
    logger.error('缺少 req 参数');
    return new Response(
      JSON.stringify({ success: false, message: 'Invalid request context' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

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
  // Assume 'data' is the entire body if it's not type/action, or directly use 'body' if needed
  const dataPayload = body; // Use the whole body as payload if type/action are top-level

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
            if (req.method !== 'GET') throw new Error('Method not allowed for GET comments');
            result = await commentsLib.getComments(dataPayload);
            break;
          case 'add':
            if (req.method !== 'POST') throw new Error('Method not allowed for POST add comment');
            result = await commentsLib.addComment(dataPayload);
            break;
          case 'update':
            if (req.method !== 'PUT') throw new Error('Method not allowed for PUT update comment');
            result = await commentsLib.updateComment(dataPayload);
            break;
          case 'delete':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for DELETE comment');
            result = await commentsLib.deleteComment(dataPayload);
            break;
          default:
            throw new Error(`Unknown action "${action}" for type "comment"`);
        }
        break;

      case 'like':
        // Route likes-related requests
        switch (action) {
          case 'add_comment_like':
            if (req.method !== 'POST') throw new Error('Method not allowed for POST addCommentLike');
            result = await likesLib.addCommentLike(dataPayload);
            break;
          case 'remove_comment_like':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for DELETE removeCommentLike');
            result = await likesLib.removeCommentLike(dataPayload);
            break;
          case 'get_direct_count':
            if (req.method !== 'GET') throw new Error('Method not allowed for GET getCommentDirectLikesCount');
            result = await likesLib.getCommentDirectLikesCount(dataPayload);
            break;
          case 'get_total_count':
            if (req.method !== 'GET') throw new Error('Method not allowed for GET getCommentTotalLikesCount');
            result = await likesLib.getCommentTotalLikesCount(dataPayload);
            break;
          case 'has_liked': // Check if user liked a comment
            if (req.method !== 'POST') throw new Error('Method not allowed for POST hasUserLikedComment');
            result = await likesLib.hasUserLikedComment(dataPayload);
            break;
          case 'add_article_like':
            if (req.method !== 'POST') throw new Error('Method not allowed for POST addArticleLike');
            result = await likesLib.addArticleLike(dataPayload);
            break;
          case 'remove_article_like':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for DELETE removeArticleLike');
            result = await likesLib.removeArticleLike(dataPayload);
            break;
          case 'get_article_count':
            if (req.method !== 'GET') throw new Error('Method not allowed for GET getArticleLikesCount');
            result = await likesLib.getArticleLikesCount(dataPayload);
            break;
          case 'has_article_liked': // Check if user liked an article
            if (req.method !== 'POST') throw new Error('Method not allowed for POST hasUserLikedArticle');
            result = await likesLib.hasUserLikedArticle(dataPayload);
            break;
          default:
            throw new Error(`Unknown action "${action}" for type "like"`);
        }
        break;

      case 'user':
        // Route user-related requests
        switch (action) {
          case 'register':
            if (req.method !== 'POST') throw new Error('Method not allowed for POST registerUser');
            result = await usersLib.registerUser(dataPayload);
            break;
          case 'login':
            if (req.method !== 'POST') throw new Error('Method not allowed for POST loginUser');
            result = await usersLib.loginUser(dataPayload);
            break;
          case 'getProfile':
            if (req.method !== 'GET') throw new Error('Method not allowed for GET getUserProfile');
            result = await usersLib.getUserProfile(dataPayload);
            break;
          case 'update':
            if (req.method !== 'PUT') throw new Error('Method not allowed for PUT updateUser');
            result = await usersLib.updateUser(dataPayload);
            break;
          case 'delete':
            if (req.method !== 'DELETE') throw new Error('Method not allowed for DELETE deleteUser');
            result = await usersLib.deleteUser(dataPayload);
            break;
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
