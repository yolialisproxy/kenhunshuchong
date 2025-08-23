// lib/likes.js - 优化版：移除TS，统一validate，重试机制

import { read, write, transaction, initFirebase, parseBody, setCORS, validateInput, logger, ValidationError } from '../lib/utils.js';

console.log('✅ lib/likes.js加载成功');

initFirebase();

// 添加文章点赞
export async function addArticleLike(username, postId) {
  if (!validateInput(username, 'id') || !validateInput(postId, 'id')) throw new ValidationError('username/postId无效');

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;

  try {
    let isNewLike = false;
    const result = await transaction(userLikePath, function(current) {
      if (current) return undefined;
      isNewLike = true;
      return { username, postId, createdAt: new Date().toISOString() };
    });

    if (!result.committed) {
      logger.warn(`已点赞 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0;
      return { isNewLike: false, likesCount: count };
    }

    await transaction(likesCountPath, function(current) { return (current || 0) + 1; });

    const updated = await read(likesCountPath) || 0;
    logger.success(`文章点赞成功 (likesCount: ${updated})`);
    return { isNewLike: true, likesCount: updated };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`添加文章点赞失败:`, error);
    throw new Error('Failed to add article like');
  }
}

// 移除文章点赞
export async function removeArticleLike(username, postId) {
  if (!validateInput(username, 'id') || !validateInput(postId, 'id')) throw new ValidationError('username/postId无效');

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;

  try {
    let isRemoved = false;
    const result = await transaction(userLikePath, function(current) {
      if (!current) return undefined;
      isRemoved = true;
      return null;
    });

    if (!result.committed) {
      logger.warn(`未点赞 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0;
      return { isRemoved: false, likesCount: count };
    }

    await transaction(likesCountPath, function(current) { return Math.max(0, (current || 0) - 1); });

    const updated = await read(likesCountPath) || 0;
    logger.success(`移除文章点赞成功 (likesCount: ${updated})`);
    return { isRemoved: true, likesCount: updated };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`移除文章点赞失败:`, error);
    throw new Error('Failed to remove article like');
  }
}

// 获取文章点赞数
export async function getArticleLikesCount(postId) {
  if (!validateInput(postId, 'id')) throw new ValidationError('postId无效');
  try {
    const count = await read(`articles/${postId}/likes`);
    return count || 0;
  } catch (error) {
    logger.error(`获取失败:`, error);
    throw new Error('Failed to get article likes');
  }
}

// 检查文章点赞状态
export async function hasUserLikedArticle(username, postId) {
  if (!validateInput(username, 'id') || !validateInput(postId, 'id')) throw new ValidationError('username/postId无效');
  try {
    const record = await read(`articleLikes/${username}_${postId}`);
    return !!record;
  } catch (error) {
    logger.error(`检查失败:`, error);
    throw new Error('Failed to check article like');
  }
}

// 计算评论总赞数 (添加重试)
export async function computeCommentTreeTotalLikes(postId, commentId, depth, maxRetries) {
  depth = depth || 0;
  maxRetries = maxRetries || 3;
  const MAX_DEPTH = 20;
  if (depth > MAX_DEPTH) {
    logger.warn(`深度超过${MAX_DEPTH}`);
    return 0;
  }

  const commentPath = `comments/${postId}/${commentId}`;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const data = await read(commentPath);
      if (!data) return 0;

      let direct = data.likes || 0;
      let childrenTotal = 0;

      if (data.children && typeof data.children === 'object') {
        const ids = Object.keys(data.children);
        for (let i = 0; i < ids.length; i++) {
          const childId = ids[i];
          if (validateInput(childId, 'id')) {
            childrenTotal += await computeCommentTreeTotalLikes(postId, childId, depth + 1, maxRetries);
          }
        }
      }

      const newTotal = direct + childrenTotal;

      if (data.totalLikes !== newTotal) {
        await write(commentPath, { totalLikes: newTotal, lastSync: Date.now() }, { method: 'update' });
        logger.info(`更新总赞数: ${newTotal}`);
      }

      return newTotal;

    } catch (error) {
      attempt++;
      logger.error(`计算失败，尝试${attempt}/${maxRetries}:`, error);
      if (attempt === maxRetries) throw new Error('Failed after retries');
      await new Promise(function(resolve) { setTimeout(resolve, 500 * attempt); });
    }
  }
  return 0;
}

// 更新祖先
export async function updateCommentAncestorsTotalLikes(postId, initialCommentId, depth) {
  depth = depth || 0;
  const MAX_DEPTH = 20;
  if (depth > MAX_DEPTH) return;

  let current = initialCommentId;
  try {
    while (current !== '0' && current) {
      const path = `comments/${postId}/${current}`;
      const comment = await read(path);

      if (!comment || !comment.parentId) break;

      await computeCommentTreeTotalLikes(postId, current);
      current = comment.parentId;
      depth++;
      if (depth > MAX_DEPTH) break;
    }
  } catch (error) {
    logger.error(`更新祖先失败:`, error);
    throw new Error('Failed to update ancestors');
  }
}

// 添加评论点赞
export async function addCommentLike(username, postId, commentId) {
  if (!validateInput(username, 'id') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('参数无效');

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) throw new ValidationError('评论不存在');

    let isNewLike = false;
    const result = await transaction(userLikePath, function(current) {
      if (current) return undefined;
      isNewLike = true;
      return { username, postId, commentId, createdAt: new Date().toISOString() };
    });

    if (!result.committed) {
      logger.warn(`已点赞`);
      const direct = await read(directLikesPath) || 0;
      const total = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isNewLike: false, directLikesCount: direct, totalLikesCount: total };
    }

    await transaction(directLikesPath, function(current) { return (current || 0) + 1; });

    await computeCommentTreeTotalLikes(postId, commentId);
    await updateCommentAncestorsTotalLikes(postId, commentId);

    const updatedDirect = await read(directLikesPath) || 0;
    const updatedTotal = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
    logger.success(`评论点赞成功`);
    return { isNewLike: true, directLikesCount: updatedDirect, totalLikesCount: updatedTotal };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`添加评论点赞失败:`, error);
    throw new Error('Failed to add comment like');
  }
}

// 移除评论点赞
export async function removeCommentLike(username, postId, commentId) {
  if (!validateInput(username, 'id') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('参数无效');

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
    const existing = await read(`comments/${postId}/${commentId}`);
    if (!existing) throw new ValidationError('评论不存在');

    let isRemoved = false;
    const result = await transaction(userLikePath, function(current) {
      if (!current) return undefined;
      isRemoved = true;
      return null;
    });

    if (!result.committed) {
      logger.warn(`未点赞`);
      const direct = await read(directLikesPath) || 0;
      const total = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isRemoved: false, directLikesCount: direct, totalLikesCount: total };
    }

    await transaction(directLikesPath, function(current) { return Math.max(0, (current || 0) - 1); });

    await computeCommentTreeTotalLikes(postId, commentId);
    await updateCommentAncestorsTotalLikes(postId, commentId);

    const updatedDirect = await read(directLikesPath) || 0;
    const updatedTotal = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
    logger.success(`移除评论点赞成功`);
    return { isRemoved: true, directLikesCount: updatedDirect, totalLikesCount: updatedTotal };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`移除评论点赞失败:`, error);
    throw new Error('Failed to remove comment like');
  }
}

// 获取评论直接点赞
export async function getCommentDirectLikesCount(postId, commentId) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('参数无效');
  try {
    const count = await read(`comments/${postId}/${commentId}/likes`);
    return count || 0;
  } catch (error) {
    logger.error(`获取直接点赞失败:`, error);
    throw new Error('Failed to get direct likes');
  }
}

// 获取总点赞
export async function getCommentTotalLikesCount(postId, commentId) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('参数无效');
  try {
    const count = await read(`comments/${postId}/${commentId}/totalLikes`);
    return count || 0;
  } catch (error) {
    logger.error(`获取总点赞失败:`, error);
    throw new Error('Failed to get total likes');
  }
}

// 检查用户是否已点赞某评论
export async function hasUserLikedComment(username, postId, commentId) {
  // 1. 输入验证：确保非空且格式正确
  if (!username || typeof username !== 'string' || !validateInput(username, 'id')) {
    throw new ValidationError('username 无效或缺失');
  }
  if (!postId || typeof postId !== 'string' || !validateInput(postId, 'id')) {
    throw new ValidationError('postId 无效或缺失');
  }
  if (!commentId || typeof commentId !== 'string' || !validateInput(commentId, 'id')) {
    throw new ValidationError('commentId 无效或缺失');
  }

  const commentLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const MAX_RETRIES = 3;

  try {
    // 2. 尝试从缓存或 Firebase 读取点赞记录
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const record = await read(commentLikePath, { timeout: 5000 });
        logger.info(`检查点赞状态 (username: ${username}, postId: ${postId}, commentId: ${commentId})`, { hasLiked: !!record });
        return !!record; // 明确布尔转换
      } catch (error) {
        attempt++;
        if (error.code === 'PERMISSION_DENIED') {
          logger.error(`无权限读取点赞记录 (path: ${commentLikePath})`, error, { username, postId, commentId });
          throw new ValidationError('无权限访问点赞记录');
        }
        logger.warn(`读取失败，尝试 ${attempt}/${MAX_RETRIES}`, error, { username, postId, commentId });
        if (attempt === MAX_RETRIES) {
          throw new Error('Failed to check comment like after retries');
        }
        await new Promise(function(resolve) { setTimeout(resolve, 500 * attempt); }); // 指数退避
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`检查点赞状态失败`, error, { username, postId, commentId });
    const message = process.env.NODE_ENV === 'development' ? error.message : '无法检查点赞状态';
    throw new Error(message);
  }
}

// API handler
export async function likeApiHandler(req, res) {
  setCORS(res, req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  let body = {};
  try {
    body = await parseBody(req);
  } catch (error) {
    logger.error('解析失败', error);
    return new Response(JSON.stringify({ success: false, message: 'Invalid body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { type, action, username, postId, commentId } = body;

  if (!type || !action || !validateInput(username, 'id') || !validateInput(postId, 'id')) {
    return new Response(JSON.stringify({ success: false, message: 'Missing/invalid params' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    let result;
    switch (type) {
      case 'article':
        switch (action) {
          case 'add':
            result = await addArticleLike(username, postId);
            break;
          case 'remove':
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
      case 'comment':
        if (!validateInput(commentId, 'id')) throw new ValidationError('commentId required');
        switch (action) {
          case 'add':
            result = await addCommentLike(username, postId, commentId);
            break;
          case 'remove':
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
          default:
            throw new ValidationError(`Unsupported action: ${action}`);
        }
        break;
      default:
        throw new ValidationError(`Unsupported type: ${type}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    logger.error('API失败', error, { type, action });
    const status = error.name === 'ValidationError' ? 400 : 500;
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Server error';
    return new Response(JSON.stringify({ success: false, message }), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handler(req, res) {
  likeApiHandler(req, res);
}

