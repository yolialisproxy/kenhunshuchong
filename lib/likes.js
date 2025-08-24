// lib/likes.js - 终极优化版：移除重复逻辑，参数校验更严谨，适配全局规范 (修正为 {...} 模式)

// 从 utils.js 导入底层数据库操作、输入验证工具
import {
  read, write, transaction, initFirebase,
  validateInput, logger, ValidationError, CONFIG
  // 移除 parseBody, setCORS 的导入，因为它们只用于 likeApiHandler (已移除)
} from './utils.js';

// 从 comments.js 导入评论树点赞计算和祖先更新逻辑，避免重复实现
import {
  computeCommentTreeTotalLikes,
  updateCommentAncestorsTotalLikes
} from './comments.js';

logger.info('✅ lib/likes.js加载成功'); // 使用 logger.info 保持一致

initFirebase();

// ====================================================================
// 文章点赞相关功能
// ====================================================================

/**
 * 用户对文章点赞
 * @param {object} data - 包含 username, postId 的对象
 * @param {string} data.username - 用户名
 * @param {string} data.postId - 文章ID
 * @returns {Promise<{ isNewLike: boolean; likesCount: number; }>} - 返回是否为新点赞及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或文章不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function addArticleLike({ username, postId }) { // 修正参数为对象解构
  if (!validateInput(username, 'username') || !validateInput(postId, 'id')) {
    throw new ValidationError('用户名或文章ID无效');
  }

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;

  try {
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
      logger.warn(`[LikesLib] 用户已点赞此文章 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0;
      return { isNewLike: false, likesCount: count };
    }

    await transaction(likesCountPath, function(current) { return (current || 0) + 1; });

    const updated = await read(likesCountPath) || 0;
    logger.info(`[LikesLib] 文章点赞成功 (username: ${username}, postId: ${postId}, likesCount: ${updated})`); // 使用 logger.info 保持一致
    return { isNewLike: true, likesCount: updated };

  } catch (error) {
    logger.error(`[LikesLib] 添加文章点赞失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to add article like');
  }
}

/**
 * 用户取消对文章点赞
 * @param {object} data - 包含 username, postId 的对象
 * @param {string} data.username - 用户名
 * @param {string} data.postId - 文章ID
 * @returns {Promise<{ isRemoved: boolean; likesCount: number; }>} - 返回是否成功移除及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或文章不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function removeArticleLike({ username, postId }) { // 修正参数为对象解构
  if (!validateInput(username, 'username') || !validateInput(postId, 'id')) {
    throw new ValidationError('用户名或文章ID无效');
  }

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;

  try {
    const articleExists = await read(`articles/${postId}`);
    if (!articleExists) {
      logger.warn('[LikesLib] 文章不存在，无需移除点赞', { postId });
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
      logger.warn(`[LikesLib] 用户未点赞此文章，无法取消 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0;
      return { isRemoved: false, likesCount: count };
    }

    await transaction(likesCountPath, function(current) { return Math.max(0, (current || 0) - 1); });

    const updated = await read(likesCountPath) || 0;
    logger.info(`[LikesLib] 移除文章点赞成功 (username: ${username}, postId: ${postId}, likesCount: ${updated})`); // 使用 logger.info 保持一致
    return { isRemoved: true, likesCount: updated };

  } catch (error) {
    logger.error(`[LikesLib] 移除文章点赞失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to remove article like');
  }
}

/**
 * 获取文章的总点赞数
 * @param {object} data - 包含 postId 的对象
 * @param {string} data.postId - 文章ID
 * @returns {Promise<number>} - 文章的点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getArticleLikesCount({ postId }) { // 修正参数为对象解构
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  try {
    const count = await read(`articles/${postId}/likes`);
    return count || 0;
  } catch (error) {
    logger.error(`[LikesLib] 获取文章点赞数失败 (postId: ${postId}):`, error);
    throw new Error('Failed to get article likes count');
  }
}

/**
 * 检查用户是否已点赞某文章
 * @param {object} data - 包含 username, postId 的对象
 * @param {string} data.username - 用户名
 * @param {string} data.postId - 文章ID
 * @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function hasUserLikedArticle({ username, postId }) { // 修正参数为对象解构
  if (!validateInput(username, 'username') || !validateInput(postId, 'id')) {
    throw new ValidationError('用户名或文章ID无效');
  }
  try {
    const record = await read(`articleLikes/${username}_${postId}`);
    return !!record;
  } catch (error) {
    logger.error(`[LikesLib] 检查文章点赞状态失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to check article like status');
  }
}

// ====================================================================
// 评论点赞相关功能 (已适配 comments.js 中的业务逻辑)
// ====================================================================

/**
 * 用户对评论点赞
 * @param {object} data - 包含 username, postId, commentId 的对象
 * @param {string} data.username - 用户名
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 评论ID
 * @returns {Promise<{ isNewLike: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否为新点赞及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或评论不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function addCommentLike({ username, postId, commentId }) { // 修正参数为对象解构
  if (!validateInput(username, 'username') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('用户名、文章ID或评论ID无效');
  }

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
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
      logger.warn(`[LikesLib] 用户已点赞此评论 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
      const direct = await read(directLikesPath) || 0;
      const total = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isNewLike: false, directLikesCount: direct, totalLikesCount: total };
    }

    await transaction(directLikesPath, function(current) { return (current || 0) + 1; });

    // 调用 comments.js 中导入的业务函数来更新 totalLikes，已适配为对象模式
    const updatedTotalLikes = await computeCommentTreeTotalLikes({ postId, commentId });
    await updateCommentAncestorsTotalLikes({ postId, initialCommentId: commentId });

    const updatedDirect = await read(directLikesPath) || 0;
    logger.info(`[LikesLib] 评论点赞成功 (username: ${username}, postId: ${postId}, commentId: ${commentId})`); // 使用 logger.info 保持一致
    return { isNewLike: true, directLikesCount: updatedDirect, totalLikesCount: updatedTotalLikes };

  } catch (error) {
    logger.error(`[LikesLib] 添加评论点赞失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to add comment like');
  }
}

/**
 * 用户取消对评论点赞
 * @param {object} data - 包含 username, postId, commentId 的对象
 * @param {string} data.username - 用户名
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 评论ID
 * @returns {Promise<{ isRemoved: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否成功移除及更新后的点赞数
 * @throws {ValidationError} 如果输入无效或评论不存在
 * @throws {Error} 如果数据库操作失败
 */
export async function removeCommentLike({ username, postId, commentId }) { // 修正参数为对象解构
  if (!validateInput(username, 'username') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('用户名、文章ID或评论ID无效');
  }

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
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
      logger.warn(`[LikesLib] 用户未点赞此评论，无法取消 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
      const direct = await read(directLikesPath) || 0;
      const total = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isRemoved: false, directLikesCount: direct, totalLikesCount: total };
    }

    await transaction(directLikesPath, function(current) { return Math.max(0, (current || 0) - 1); });

    // 调用 comments.js 中导入的业务函数来更新 totalLikes，已适配为对象模式
    const updatedTotalLikes = await computeCommentTreeTotalLikes({ postId, commentId });
    await updateCommentAncestorsTotalLikes({ postId, initialCommentId: commentId });

    const updatedDirect = await read(directLikesPath) || 0;
    logger.info(`[LikesLib] 移除评论点赞成功 (username: ${username}, postId: ${postId}, commentId: ${commentId})`); // 使用 logger.info 保持一致
    return { isRemoved: true, directLikesCount: updatedDirect, totalLikesCount: updatedTotalLikes };

  } catch (error) {
    logger.error(`[LikesLib] 移除评论点赞失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to remove comment like');
  }
}

/**
 * 获取评论的直接点赞数
 * @param {object} data - 包含 postId, commentId 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 评论ID
 * @returns {Promise<number>} - 评论的直接点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getCommentDirectLikesCount({ postId, commentId }) { // 修正参数为对象解构
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('文章ID或评论ID无效');
  try {
    const count = await read(`comments/${postId}/${commentId}/likes`);
    return count || 0;
  } catch (error) {
    logger.error(`[LikesLib] 获取评论直接点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get comment direct likes count');
  }
}

/**
 * 获取评论及其子评论的总点赞数 (totalLikes)
 * @param {object} data - 包含 postId, commentId 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 评论ID
 * @returns {Promise<number>} - 评论及其子评论的总点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getCommentTotalLikesCount({ postId, commentId }) { // 修正参数为对象解构
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) throw new ValidationError('文章ID或评论ID无效');
  try {
    const count = await read(`comments/${postId}/${commentId}/totalLikes`);
    return count || 0;
  } catch (error) {
    logger.error(`[LikesLib] 获取评论总点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to get comment total likes count');
  }
}

/**
 * 检查用户是否已点赞某评论
 * @param {object} data - 包含 username, postId, commentId 的对象
 * @param {string} data.username - 用户名
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 评论ID
 * @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function hasUserLikedComment({ username, postId, commentId }) { // 修正参数为对象解构
  if (!validateInput(username, 'username') || !validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('用户名、文章ID或评论ID无效');
  }

  const commentLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const maxRetries = CONFIG.MAX_RETRIES || 3;
  const retryIntervalBase = CONFIG.RETRY_INTERVAL_BASE || 500;

  try {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const record = await read(commentLikePath, { timeout: CONFIG.TIMEOUT });
        logger.info(`[LikesLib] 检查评论点赞状态 (username: ${username}, postId: ${postId}, commentId: ${commentId})`, { hasLiked: !!record }); // 使用 logger.info 保持一致
        return !!record;
      } catch (error) {
        attempt++;
        if (error.code === 'PERMISSION_DENIED') {
          logger.error(`[LikesLib] 无权限读取点赞记录 (path: ${commentLikePath})`, error, { username, postId, commentId });
          throw new ValidationError('无权限访问点赞记录');
        }
        logger.warn(`[LikesLib] 读取评论点赞状态失败，尝试 ${attempt}/${maxRetries}`, error, { username, postId, commentId });
        if (attempt === maxRetries) {
          throw new Error('Failed to check comment like status after retries');
        }
        await new Promise(function(resolve) { setTimeout(resolve, retryIntervalBase * attempt); }); // 指数退避
      }
    }
  } catch (error) {
    logger.error(`[LikesLib] 检查评论点赞状态失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to check comment like status');
  }
  return false; // 理论上应该在循环中返回或抛出，这里是兜底
}

// 移除了默认导出的 likeApiHandler 函数，因为 api/index.js 将直接调用上述业务逻辑函数。
// Control comes from api/index.js (central dispatcher).
