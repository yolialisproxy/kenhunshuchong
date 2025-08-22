// api/index.js - 优化版：添加缓存头，统一JS

import { likeApiHandler } from '../lib/likes.js';
import { userApiHandler } from '../lib/users.js';
import { commentApiHandler } from '../lib/comments.js';
import { setCORS, logger } from '../lib/utils.js';

console.log('✅ api/index.js加载成功');

const routes = {
  '/api/comments': commentApiHandler,
  '/api/likes': likeApiHandler,
  '/api/users': userApiHandler,
};

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

default async function handler(req, res) {
  setCORS(res, req);

  const url = new URL(req.url, `https://${process.env.VERCEL_URL || 'localhost'}`);
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, '');
  const method = req.method.toUpperCase();

  logger.info(`请求: ${method} ${pathname}`);

  try {
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (!ALLOWED_METHODS.includes(method)) {
      return new Response(JSON.stringify({ success: false, message: `Method ${method} not allowed` }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    const handlerFn = routes[pathname];
    if (handlerFn) {
      if (method === 'GET') {
        res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
      }
      return await handlerFn(req, res);
    }

    return new Response(JSON.stringify({ success: false, message: `Route not found: ${pathname}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    logger.error('Gateway错误', error, { pathname, method });
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal error';
    return new Response(JSON.stringify({ success: false, message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
