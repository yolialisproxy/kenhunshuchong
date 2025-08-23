// lib/likes.js - 终极优化版：移除重复逻辑，参数校验更严谨，适配全局规范

// 从 utils.js 导入底层数据库操作、HTTP 辅助函数、以及输入验证工具
import {
  read, write, transaction, initFirebase,
  parseBody, setCORS, validateInput, logger, ValidationError, CONFIG
} from './utils.js';

// 从 comments.js 导入评论树点赞计算和祖先更新逻辑，避免重复实现
// 这些函数在 comments.js 中调用 utils.js 的核心计算，并负责更新数据库
import {
  computeCommentTreeTotalLikes,
  updateCommentAncestorsTotalLikes
} from './comments.js';

console.log('✅ lib/likes.js加载成功');

initFirebase();

// ====================================================================
// 文章点赞相关功能
// ====================================================================

/**
 * 用户对文章点赞
 * @param {string} username - 用户名
 * @param {string} postId - 文章ID
 * @returns {Promise<{ isNewLike: boolean; likesCount: number; }>} - 返回是否为新点赞及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或文章不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function addArticleLike(username, postId) {
  // 修正验证类型，使用 'username'
  if (!validateInput(username, 'username') || !validateInput(postId, 'id')) {
    throw new ValidationError('用户名或文章ID无效');
  }

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;

  try {
    // 检查文章是否存在 (增加健壮性)
    const articleExists = await read(`articles/${postId}`);
    if (!articleExists) {
        throw new ValidationError('文章不存在，无法点赞');
    }

    let isNewLike = false;
    const result = await transaction(userLikePath, function(current) {
      if (current) return undefined; // 已点赞
      isNewLike = true;
      return { username, postId, createdAt: new Date().toISOString() };
    });

    if (!result.committed) {
      logger.warn(`用户已点赞此文章 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0;
      return { isNewLike: false, likesCount: count };
    }

    await transaction(likesCountPath, function(current) { return (current || 0) + 1; });

    const updated = await read(likesCountPath) || 0;
    logger.success(`文章点赞成功 (username: ${username}, postId: ${postId}, likesCount: ${updated})`);
    return { isNewLike: true, likesCount: updated };

  } catch (error) {
    logger.error(`添加文章点赞失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to add article like');
  }
}

/**
 * 用户取消对文章点赞
 * @param {string} username - 用户名
 * @param {string} postId - 文章ID
 * @returns {Promise<{ isRemoved: boolean; likesCount: number; }>} - 返回是否成功移除及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或文章不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function removeArticleLike(username, postId) {
  // 修正验证类型，使用 'username'
  if (!validateInput(username, 'username') || !validateInput(postId, 'id')) {
    throw new ValidationError('用户名或文章ID无效');
  }

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;

  try {
    // 检查文章是否存在 (增加健壮性)
    const articleExists = await read(`articles/${postId}`);
    if (!articleExists) {
      // 如果文章不存在，则无需移除点赞，直接视为已移除并返回当前count
      logger.warn('文章不存在，无需移除点赞', { postId });
      const currentCount = await read(likesCountPath) || 0;
      return { isRemoved: false, likesCount: currentCount };
    }

    let isRemoved = false;
    const result = await transaction(userLikePath, function(current) {
      if (!current) return undefined; // 未点赞
      isRemoved = true;
      return null;
    });

    if (!result.committed) {
      logger.warn(`用户未点赞此文章，无法取消 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0;
      return { isRemoved: false, likesCount: count };
    }

    await transaction(likesCountPath, function(current) { return Math.max(0, (current || 0) - 1); });

    const updated = await read(likesCountPath) || 0;
    logger.success(`移除文章点赞成功 (username: ${username}, postId: ${postId}, likesCount: ${updated})`);
    return { isRemoved: true, likesCount: updated };

  } catch (error) {
    logger.error(`移除文章点赞失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to remove article like');
  }
}

/**
 * 获取文章的总点赞数
 * @param {string} postId - 文章ID
 * @returns {Promise<number>} - 文章的点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getArticleLikesCount(postId) {
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  try {
    const count = await read(`articles/${postId}/likes`);
    return count || 0;
  } catch (error) {
    logger.error(`获取文章点赞数失败 (postId: ${postId}):`, error);
    throw new Error('Failed to get article likes count');
  }
}

/**
 * 检查用户是否已点赞某文章
 * @param {string} username - 用户名
 * @param {string} postId - 文章ID
 * @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function hasUserLikedArticle(username, postId) {
  // 修正验证类型，使用 'username'
  if (!validateInput(username, 'username') || !validateInput(postId, 'id')) {
    throw new ValidationError('用户名或文章ID无效');
  }
  try {
    const record = await read(`articleLikes/${username}_${postId}`);
    return !!record;
  } catch (error) {
    logger.error(`检查文章点赞状态失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to check article like status');
  }
}

// ====================================================================
// 评论点赞相关功能 (依赖 comments.js 中的业务逻辑)
// ====================================================================

// 移除 lib/likes.js 中重复的 computeCommentTreeTotalLikes 和 updateCommentAncestorsTotalLikes
// 改为从 comments.js 导入，这里是示意性导入，实际应在文件开头导入


/**
 * 用户对评论点赞
 * @param {string} username - 用户名
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<{ isNewLike: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否为新点赞及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或评论不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function addCommentLike(username, postId, commentId) {
  // 修正验证类型，使用 'username'
  if (!validateInput(username, 'username') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('用户名、文章ID或评论ID无效');
  }

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
    // 检查评论是否存在 (增加健壮性)
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) {
        throw new ValidationError('评论不存在，无法点赞');
    }

    let isNewLike = false;
    const result = await transaction(userLikePath, function(current) {
      if (current) return undefined; // 已点赞
      isNewLike = true;
      return { username, postId, commentId, createdAt: new Date().toISOString() };
    });

    if (!result.committed) {
      logger.warn(`用户已点赞此评论 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
      const direct = await read(directLikesPath) || 0;
      const total = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isNewLike: false, directLikesCount: direct, totalLikesCount: total };
    }

    await transaction(directLikesPath, function(current) { return (current || 0) + 1; });

    // 调用 comments.js 中导入的业务函数来更新 totalLikes
    const updatedTotalLikes = await computeCommentTreeTotalLikes(postId, commentId);
    await updateCommentAncestorsTotalLikes(postId, commentId);

    const updatedDirect = await read(directLikesPath) || 0;
    logger.success(`评论点赞成功 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
    return { isNewLike: true, directLikesCount: updatedDirect, totalLikesCount: updatedTotalLikes };

  } catch (error) {
    logger.error(`添加评论点赞失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to add comment like');
  }
}

/**
 * 用户取消对评论点赞
 * @param {string} username - 用户名
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<{ isRemoved: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否成功移除及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或评论不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function removeCommentLike(username, postId, commentId) {
  // 修正验证类型，使用 'username'
  if (!validateInput(username, 'username') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('用户名、文章ID或评论ID无效');
  }

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
    // 检查评论是否存在 (增加健壮性)
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) {
        throw new ValidationError('评论不存在，无法取消点赞');
    }

    let isRemoved = false;
    const result = await transaction(userLikePath, function(current) {
      if (!current) return undefined; // 未点赞
      isRemoved = true;
      return null;
    });

    if (!result.committed) {
      logger.warn(`用户未点赞此评论，无法取消 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
      const direct = await read(directLikesPath) || 0;
      const total = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isRemoved: false, directLikesCount: direct, totalLikesCount: total };
    }

    await transaction(directLikesPath, function(current) { return Math.max(0, (current || 0) - 1); });

    // 调用 comments.js 中导入的业务函数来更新 totalLikes
    const updatedTotalLikes = await computeCommentTreeTotalLikes(postId, commentId);
    await updateCommentAncestorsTotalLikes(postId, commentId);

    const updatedDirect = await read(directLikesPath) || 0;
    logger.success(`移除评论点赞成功 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
    return { isRemoved: true, directLikesCount: updatedDirect, totalLikesCount: updatedTotalLikes };

  } catch (error) {
    logger.error(`移除评论点赞失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to remove comment like');
  }
}

/**
 * 获取评论的直接点赞数
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<number>} - 评论的直接点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getCommentDirectLikesCount(postId, commentId) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('文章ID或评论ID无效');
  try {
    const count = await read(`comments/${postId}/${commentId}/likes`);
    return count || 0;
  } catch (error) {
    logger.error(`获取评论直接点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get comment direct likes count');
  }
}

/**
 * 获取评论及其子评论的总点赞数 (totalLikes)
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<number>} - 评论及其子评论的总点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getCommentTotalLikesCount(postId, commentId) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('文章ID或评论ID无效');
  try {
    const count = await read(`comments/${postId}/${commentId}/totalLikes`);
    return count || 0;
  } catch (error) {
    logger.error(`获取评论总点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get comment total likes count');
  }
}

/**
 * 检查用户是否已点赞某评论
 * @param {string} username - 用户名
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function hasUserLikedComment(username, postId, commentId) {
  // 修正验证类型和错误信息，使用 'username'
  if (!validateInput(username, 'username') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('用户名、文章ID或评论ID无效');
  }

  const commentLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  // 从 CONFIG 中获取重试次数和间隔
  const maxRetries = CONFIG.MAX_RETRIES || 3;
  const retryIntervalBase = CONFIG.RETRY_INTERVAL_BASE || 500; // 假设 utils.js 定义了这些

  try {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const record = await read(commentLikePath, { timeout: CONFIG.TIMEOUT });
        logger.info(`检查评论点赞状态 (username: ${username}, postId: ${postId}, commentId: ${commentId})`, { hasLiked: !!record });
        return !!record;
      } catch (error) {
        attempt++;
        if (error.code === 'PERMISSION_DENIED') {
          logger.error(`无权限读取点赞记录 (path: ${commentLikePath})`, error, { username, postId, commentId });
          throw new ValidationError('无权限访问点赞记录');
        }
        logger.warn(`读取评论点赞状态失败，尝试 ${attempt}/${maxRetries}`, error, { username, postId, commentId });
        if (attempt === maxRetries) {
          throw new Error('Failed to check comment like status after retries');
        }
        await new Promise(function(resolve) { setTimeout(resolve, retryIntervalBase * attempt); }); // 指数退避
      }
    }
  } catch (error) {
    logger.error(`检查评论点赞状态失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to check comment like status');
  }
  return false; // 理论上应该在循环中返回或抛出，这里是兜底
}


// API handler
// 默认导出，Vercel Serverless Function 入口
export default async function likeApiHandler(req, res) { // 修正为默认导出
  // 获取原始响应头，为了能够正确合并 CORS 头
  const responseHeaders = req.headers ? Object.fromEntries(req.headers.entries()) : {};
  setCORS(res, req); // 设置 CORS 头

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...res.headers.raw(), ...responseHeaders, 'Content-Type': 'application/json' } // 合并 CORS 头
    });
  }

  let body = {};
  if (req.method === 'POST') { // Liks API 主要是 POST 请求，仅解析 POST 请求体
    try {
      body = await parseBody(req);
    } catch (error) {
      logger.error('likeApiHandler: 请求体解析失败', error);
      return new Response(JSON.stringify({ success: false, message: 'Invalid request body' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...res.headers.raw(), // 合并 CORS 头
          ...responseHeaders
        }
      });
    }
  }
  // GET 请求的参数从 URL query 获取
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);

  // 从 URL query 或 body 中提取参数，body 优先
  const type = body.type || url.searchParams.get('type');
  const action = body.action || url.searchParams.get('action');
  const username = body.username || url.searchParams.get('username');
  const postId = body.postId || url.searchParams.get('postId');
  const commentId = body.commentId || url.searchParams.get('commentId');

  try {
    // 基础参数验证，对所有点赞操作通用
    if (!type || !action || !username || !postId) {
      throw new ValidationError('缺少必要的参数 (type, action, username, postId)');
    }
    // 对 username, postId 进行格式验证
    if (!validateInput(username, 'username')) throw new ValidationError('用户名格式无效');
    if (!validateInput(postId, 'id')) throw new ValidationError('文章ID格式无效');

    let result;
    switch (type) {
      case 'article': // 这里的 type 从 'articleLike' 改为 'article' 更简洁
        switch (action) {
          case 'add':
            result = await addArticleLike(username, postId);
            break;
          case 'remove':
            result = await removeArticleLike(username, postId);
            break;
          case 'get_count': // GET 请求
            if (req.method !== 'GET') throw new ValidationError('获取文章点赞数只支持 GET 请求');
            result = await getArticleLikesCount(postId);
            break;
          case 'has_liked': // GET 请求
            if (req.method !== 'GET') throw new ValidationError('检查文章点赞状态只支持 GET 请求');
            result = await hasUserLikedArticle(username, postId);
            break;
          default:
            throw new ValidationError(`Unsupported action for article likes: ${action}`);
        }
        break;
      case 'comment': // 这里的 type 从 'commentLike' 改为 'comment' 更简洁
        if (!commentId) throw new ValidationError('评论点赞操作需要 commentId');
        if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID格式无效');

        switch (action) {
          case 'add':
            result = await addCommentLike(username, postId, commentId);
            break;
          case 'remove':
            result = await removeCommentLike(username, postId, commentId);
            break;
          case 'get_direct_count': // GET 请求
            if (req.method !== 'GET') throw new ValidationError('获取评论直接点赞数只支持 GET 请求');
            result = await getCommentDirectLikesCount(postId, commentId);
            break;
          case 'get_total_count': // GET 请求
            if (req.method !== 'GET') throw new ValidationError('获取评论总点赞数只支持 GET 请求');
            result = await getCommentTotalLikesCount(postId, commentId);
            break;
          case 'has_liked': // GET 请求
            if (req.method !== 'GET') throw new ValidationError('检查评论点赞状态只支持 GET 请求');
            result = await hasUserLikedComment(username, postId, commentId);
            break;
          default:
            throw new ValidationError(`Unsupported action for comment likes: ${action}`);
        }
        break;
      default:
        throw new ValidationError(`Unsupported resource type: ${type}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...res.headers.raw(), // 合并 CORS 头
        ...responseHeaders
      }
    });

  } catch (error) {
    logger.error('likeApiHandler: API处理失败', error, { type, action, username, postId, commentId });
    let status = 500;
    if (error instanceof ValidationError) {
      status = 400;
    } else if (error.message.includes('not found')) { // 针对文章/评论不存在的错误
        status = 404;
    }

    const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ success: false, message: message }), {
      status: status,
      headers: {
        'Content-Type': 'application/json',
        ...res.headers.raw(), // 合并 CORS 头
        ...responseHeaders
      }
    });
  }
}
