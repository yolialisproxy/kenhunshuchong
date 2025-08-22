// api/index.js - Vercel Serverless Functions 的总入口点，负责精确路由分发

// 导入各个业务模块的默认 API 接口处理器
import { likeApiHandler } from '../lib/likes.js';
import { userApiHandler } from '../lib/users.js';
import { commentApiHandler } from '../lib/comments.js';
import { setCORS, logger } from '../lib/utils.js'; // 导入通用 CORS 设置

console.log('✅ api/index.js加载成功');

/**
 * Vercel Serverless Function 的主处理函数
 * 根据请求的精确路径分发到不同的业务模块处理器
 */
export default async function handler(req, res) {
  setCORS(res, req);

  const url = new URL(req.url || '', `http://${req.headers.get('host')}`);
  const pathname = url.pathname;
  const method = req.method;

  logger.info(`收到请求: ${method} ${pathname}`);

  if (method === 'OPTIONS') {
    logger.info(`处理 OPTIONS 请求: ${pathname}`);
    return new Response(null, { status: 204, headers: res.headers });
  }

  try {
    // 2. 根据精确路径分发请求到相应的模块处理器
    if (pathname === '/api/comments') {
      logger.info(`路由到 Comments 模块: ${pathname}`);
      // commentsApiHandler 内部会处理 GET, POST, PUT, DELETE 方法
      return await commentApiHandler(req, res);
    }
    else if (pathname === '/api/likes') { // 假设点赞的统一路径是 /api/likes
      logger.info(`路由到 Likes 模块: ${pathname}`);
      // likeApiHandler 内部会处理 GET, POST, DELETE 等方法
      return await likeApiHandler(req, res);
    }
    else if (pathname === '/api/users') { // 假设用户的统一路径是 /api/users
      logger.info(`路由到 User 模块: ${pathname}`);
      // userApiHandler 内部会处理 POST, GET 等方法
      return await userApiHandler(req, res);
    }
    // TODO: 如果有其他 API 路由，在这里添加 else if 块

    // 3. 如果没有匹配到任何路由
    logger.warn(`未找到匹配的 API 路由: ${pathname}`);
    return new Response(JSON.stringify({ success: false, message: `API route not found: ${pathname}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });

  } catch (error: any) {
    // 4. 捕获顶层未处理的全局性错误
    logger.error('API Gateway 发生未预期错误', error, { pathname, method });
    return new Response(JSON.stringify({ success: false, message: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });
  }
}
