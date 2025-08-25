// lib/likes.js - 终极优化版：移除重复逻辑，参数校验更严谨，适配全局规范 (修正为 {...} 模式)
// 从 utils.js 导入底层数据库操作、输入验证工具
import {
  read, write, transaction, initFirebase,
  validateInput, logger, ValidationError, CONFIG
} from '../lib/utils.js'; // Ensure all necessary utilities are imported
// 从 comments.js 导入评论树点赞计算和祖先更新逻辑，避免重复实现
import {
  computeCommentTreeTotalLikes,
  updateCommentAncestorsTotalLikes
} from './comments.js';

// Logger initialization consistency
logger.info('✅ lib/likes.js 加载成功');

// Initialize Firebase database instance on module load
initFirebase();

// ====================================================================
// 文章点赞相关功能
// ====================================================================

/**
* 用户对文章点赞。
* @param {object} data - 包含 username, postId 的对象
* @param {string} data.username - 用户名
* @param {string} data.postId - 文章ID
* @returns {Promise<{ isNewLike: boolean; likesCount: number; }>} - 返回是否为新点赞及更新后的点赞数。
* @throws {ValidationError} 如果输入无效或文章不存在
* @throws {Error} 如果数据库操作失败
*/
export async function addArticleLike({ username, postId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const userLikePath = `articleLikes/${username}_${postId}`; // Path to store user's like status
  const likesCountPath = `articles/${postId}/likes`; // Path to store the total likes count for the article
  try {
    // --- 2. Check Article Existence ---
    const articleExists = await read(`articles/${postId}`);
    if (!articleExists) {
        throw new ValidationError('文章不存在，无法点赞');
    }

    let isNewLike = false;
    // --- 3. Atomically update user's like status ---
    const result = await transaction(userLikePath, function(current) {
      // If current is already populated, it means the user has liked it before. Return undefined to abort.
      if (current) return undefined;
      // Otherwise, create a new record and set isNewLike to true.
      isNewLike = true;
      return { username, postId, createdAt: new Date().toISOString() };
    });

    // If transaction didn't commit (likely because it was already liked), return current count.
    if (!result.committed) {
      logger.warn(`[LikesLib] 用户已点赞此文章，无法重复点赞 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0; // Read current count
      return { isNewLike: false, likesCount: count };
    }

    // --- 4. Atomically increment the article's total likes count ---
    await transaction(likesCountPath, function(currentCount) {
      // Ensure count is a non-negative number
      return Math.max(0, (currentCount || 0) + 1);
    });

    // --- 5. Get Updated Count and Return ---
    const updatedLikesCount = await read(likesCountPath) || 0;
    logger.info(`[LikesLib] 文章点赞成功 (username: ${username}, postId: ${postId}, newLikesCount: ${updatedLikesCount})`);
    return { isNewLike: true, likesCount: updatedLikesCount };

  } catch (error) {
    logger.error(`[LikesLib] 添加文章点赞失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to add article like.'); // General error
  }
}

/**
* 用户取消对文章点赞。
* @param {object} data - 包含 username, postId 的对象
* @param {string} data.username - 用户名
* @param {string} data.postId - 文章ID
* @returns {Promise<{ isRemoved: boolean; likesCount: number; }>} - 返回是否成功移除及更新后的点赞数。
* @throws {ValidationError} 如果输入无效或文章不存在
* @throws {Error} 如果数据库操作失败
*/
export async function removeArticleLike({ username, postId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const userLikePath = `articleLikes/${username}_${postId}`;
  const likesCountPath = `articles/${postId}/likes`;
  try {
    // --- 2. Check Article Existence ---
    const articleExists = await read(`articles/${postId}`);
    if (!articleExists) {
      logger.warn(`[LikesLib] 文章不存在，无需移除点赞 (postId: ${postId})`);
      const currentCount = await read(likesCountPath) || 0;
      return { isRemoved: false, likesCount: currentCount };
    }

    let isRemoved = false;
    // --- 3. Atomically remove user's like status ---
    const result = await transaction(userLikePath, function(current) {
      // If current is null/undefined, user hasn't liked it. Return undefined to abort.
      if (!current) return undefined;
      // Otherwise, delete the record and set isRemoved to true.
      isRemoved = true;
      return null; // Returning null deletes the node
    });

    // If transaction didn't commit (likely because it was already unliked), return current count.
    if (!result.committed) {
      logger.warn(`[LikesLib] 用户未点赞此文章，无法取消点赞 (username: ${username}, postId: ${postId})`);
      const count = await read(likesCountPath) || 0; // Read current count
      return { isRemoved: false, likesCount: count };
    }

    // --- 4. Atomically decrement the article's total likes count ---
    await transaction(likesCountPath, function(currentCount) {
      // Ensure count doesn't go below zero
      return Math.max(0, (currentCount || 0) - 1);
    });

    // --- 5. Get Updated Count and Return ---
    const updatedLikesCount = await read(likesCountPath) || 0;
    logger.info(`[LikesLib] 移除文章点赞成功 (username: ${username}, postId: ${postId}, newLikesCount: ${updatedLikesCount})`);
    return { isRemoved: true, likesCount: updatedLikesCount };

  } catch (error) {
    logger.error(`[LikesLib] 移除文章点赞失败 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to remove article like.'); // General error
  }
}

/**
* 获取文章的总点赞数。
* @param {object} data - 包含 postId 的对象
* @param {string} data.postId - 文章ID
* @returns {Promise<number>} - 文章的点赞数。
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function getArticleLikesCount({ postId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');

  try {
    const count = await read(`articles/${postId}/likes`); // Read the likes count
    return count || 0; // Return count, defaulting to 0 if null/undefined
  } catch (error) {
    logger.error(`[LikesLib] 获取文章点赞数失败 (postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to get article likes count.'); // General error
  }
}

/**
* 检查用户是否已点赞某文章。
* @param {object} data - 包含 username, postId 的对象
* @param {string} data.username - 用户名
* @param {string} data.postId - 文章ID
* @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false。
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function hasUserLikedArticle({ username, postId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const userLikePath = `articleLikes/${username}_${postId}`;
  const maxRetries = CONFIG.MAX_RETRIES || 3;
  const retryIntervalBase = CONFIG.RETRY_INTERVAL_BASE || 500;

  try {
    let attempt = 0;
    // --- Retry Logic for Read Operation ---
    while (attempt < maxRetries) {
      try {
        // Attempt to read the user's like record
        const record = await read(userLikePath, { timeout: CONFIG.TIMEOUT });
        logger.info(`[LikesLib] 检查文章点赞状态 (username: ${username}, postId: ${postId})`, { hasLiked: !!record });
        return !!record; // Return true if record exists, false otherwise
      } catch (error) {
        attempt++;
        // Handle specific errors like permission denied
        if (error.code === 'PERMISSION_DENIED') {
          logger.error(`[LikesLib] 无权限读取文章点赞记录 (path: ${userLikePath})`, error, { username, postId });
          throw new ValidationError('无权限访问点赞记录');
        }
        // Log retry attempts for other errors
        logger.warn(`[LikesLib] 读取文章点赞状态失败，尝试 ${attempt}/${maxRetries}`, error, { username, postId });
        // If max retries reached, throw a final error
        if (attempt === maxRetries) {
          throw new Error('Failed to check article like status after multiple retries.');
        }
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, retryIntervalBase * Math.pow(2, attempt - 1)));
      }
    }
  } catch (error) {
    logger.error(`[LikesLib] 检查文章点赞状态时发生错误 (username: ${username}, postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to check article like status.'); // General error
  }
  return false; // Should not be reached if logic is correct, but provides a fallback return
}

// ====================================================================
// 评论点赞相关功能 (已适配 comments.js 中的业务逻辑)
// ====================================================================

/**
* 用户对评论点赞。
* @param {object} data - 包含 username, postId, commentId 的对象
* @param {string} data.username - 用户名
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 评论ID
* @returns {Promise<{ isNewLike: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否为新点赞及更新后的点赞数。
* @throws {ValidationError} 如果输入无效或评论不存在
* @throws {Error} 如果数据库操作失败
*/
export async function addCommentLike({ username, postId, commentId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`; // Path for user's like status on a comment
  const directLikesPath = `comments/${postId}/${commentId}/likes`; // Path for the direct likes count of the comment

  try {
    // --- 2. Check Comment Existence ---
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) {
        throw new ValidationError('评论不存在，无法点赞');
    }

    let isNewLike = false;
    // --- 3. Atomically update user's like status for the comment ---
    const result = await transaction(userLikePath, function(current) {
      if (current) return undefined; // Already liked, abort transaction
      isNewLike = true;
      return { username, postId, commentId, createdAt: new Date().toISOString() };
    });

    // If transaction didn't commit (already liked), return current counts
    if (!result.committed) {
      logger.warn(`[LikesLib] 用户已点赞此评论，无法重复点赞 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
      const directLikes = await read(directLikesPath) || 0;
      const totalLikes = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isNewLike: false, directLikesCount: directLikes, totalLikesCount: totalLikes };
    }

    // --- 4. Atomically increment the comment's direct likes count ---
    await transaction(directLikesPath, function(currentDirectLikes) {
      return Math.max(0, (currentDirectLikes || 0) + 1);
    });

    // --- 5. Update totalLikes for the comment and its ancestors ---
    // This is a crucial part, calling the logic from comments.js
    const updatedTotalLikes = await computeCommentTreeTotalLikes({ postId, commentId });
    await updateCommentAncestorsTotalLikes({ postId, initialCommentId: commentId });

    // --- 6. Get Updated Direct Likes Count and Return ---
    const updatedDirectLikes = await read(directLikesPath) || 0;
    logger.info(`[LikesLib] 评论点赞成功 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
    return { isNewLike: true, directLikesCount: updatedDirectLikes, totalLikesCount: updatedTotalLikes };

  } catch (error) {
    logger.error(`[LikesLib] 添加评论点赞失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to add comment like.'); // General error
  }
}

/**
* 用户取消对评论点赞。
* @param {object} data - 包含 username, postId, commentId 的对象
* @param {string} data.username - 用户名
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 评论ID
* @returns {Promise<{ isRemoved: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否成功移除及更新后的点赞数。
* @throws {ValidationError} 如果输入无效或评论不存在
* @throws {Error} 如果数据库操作失败
*/
export async function removeCommentLike({ username, postId, commentId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const userLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const directLikesPath = `comments/${postId}/${commentId}/likes`;

  try {
    // --- 2. Check Comment Existence ---
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) {
        throw new ValidationError('评论不存在，无法取消点赞');
    }

    let isRemoved = false;
    // --- 3. Atomically remove user's like status for the comment ---
    const result = await transaction(userLikePath, function(current) {
      if (!current) return undefined; // Not liked, abort transaction
      isRemoved = true;
      return null; // Remove the record
    });

    // If transaction didn't commit (already unliked), return current counts
    if (!result.committed) {
      logger.warn(`[LikesLib] 用户未点赞此评论，无法取消点赞 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
      const directLikes = await read(directLikesPath) || 0;
      const totalLikes = await read(`comments/${postId}/${commentId}/totalLikes`) || 0;
      return { isRemoved: false, directLikesCount: directLikes, totalLikesCount: totalLikes };
    }

    // --- 4. Atomically decrement the comment's direct likes count ---
    await transaction(directLikesPath, function(currentDirectLikes) {
      return Math.max(0, (currentDirectLikes || 0) - 1);
    });

    // --- 5. Update totalLikes for the comment and its ancestors ---
    const updatedTotalLikes = await computeCommentTreeTotalLikes({ postId, commentId });
    await updateCommentAncestorsTotalLikes({ postId, initialCommentId: commentId });

    // --- 6. Get Updated Direct Likes Count and Return ---
    const updatedDirectLikes = await read(directLikesPath) || 0;
    logger.info(`[LikesLib] 移除评论点赞成功 (username: ${username}, postId: ${postId}, commentId: ${commentId})`);
    return { isRemoved: true, directLikesCount: updatedDirectLikes, totalLikesCount: updatedTotalLikes };

  } catch (error) {
    logger.error(`[LikesLib] 移除评论点赞失败 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to remove comment like.'); // General error
  }
}

/**
* 获取评论的直接点赞数。
* @param {object} data - 包含 postId, commentId 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 评论ID
* @returns {Promise<number>} - 评论的直接点赞数。
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function getCommentDirectLikesCount({ postId, commentId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');

  try {
    const count = await read(`comments/${postId}/${commentId}/likes`); // Read direct likes count
    return count || 0; // Return count, defaulting to 0
  } catch (error) {
    logger.error(`[LikesLib] 获取评论直接点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to get comment direct likes count.'); // General error
  }
}

/**
* 获取评论及其子评论的总点赞数 (totalLikes)。
* @param {object} data - 包含 postId, commentId 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 评论ID
* @returns {Promise<number>} - 评论及其子评论的总点赞数。
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function getCommentTotalLikesCount({ postId, commentId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');

  try {
    const count = await read(`comments/${postId}/${commentId}/totalLikes`); // Read total likes count
    return count || 0; // Return count, defaulting to 0
  } catch (error) {
    logger.error(`[LikesLib] 获取评论总点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to get comment total likes count.'); // General error
  }
}

/**
* 检查用户是否已点赞某评论。
* @param {object} data - 包含 username, postId, commentId 的对象
* @param {string} data.username - 用户名
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 评论ID
* @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false。
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function hasUserLikedComment({ username, postId, commentId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const commentLikePath = `commentLikes/${postId}/${commentId}/${username}`;
  const maxRetries = CONFIG.MAX_RETRIES || 3; // Use config for retries
  const retryIntervalBase = CONFIG.RETRY_INTERVAL_BASE || 500; // Use config for retry interval

  try {
    let attempt = 0;
    // --- Retry Logic for Read Operation ---
    while (attempt < maxRetries) {
      try {
        // Attempt to read the user's like record for the comment
        const record = await read(commentLikePath, { timeout: CONFIG.TIMEOUT });
        logger.info(`[LikesLib] 检查评论点赞状态 (username: ${username}, postId: ${postId}, commentId: ${commentId})`, { hasLiked: !!record });
        return !!record; // Return true if record exists, false otherwise
      } catch (error) {
        attempt++;
        // Handle specific errors like permission denied
        if (error.code === 'PERMISSION_DENIED') {
          logger.error(`[LikesLib] 无权限读取评论点赞记录 (path: ${commentLikePath})`, error, { username, postId, commentId });
          throw new ValidationError('无权限访问点赞记录');
        }
        // Log retry attempts for other errors
        logger.warn(`[LikesLib] 读取评论点赞状态失败，尝试 ${attempt}/${maxRetries}`, error, { username, postId, commentId });
        // If max retries reached, throw a final error
        if (attempt === maxRetries) {
          throw new Error('Failed to check comment like status after multiple retries.');
        }
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, retryIntervalBase * Math.pow(2, attempt - 1)));
      }
    }
  } catch (error) {
    logger.error(`[LikesLib] 检查评论点赞状态时发生错误 (username: ${username}, postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to check comment like status.'); // General error
  }
  // Fallback return, theoretically unreachable if logic is sound
  return false;
}
