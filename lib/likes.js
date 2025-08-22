// lib/likes.js - 统一的文章和评论点赞业务逻辑模块，并提供一个默认导出的HTTP接口

// 从 utils.js 导入底层数据库操作和 HTTP 辅助函数
import { read, write, del, transaction, withTimeout, initFirebase, parseBody, setCORS } from './utils.js';

console.log('✅ lib/likes.js加载成功');

initFirebase(); // 确保 Firebase 数据库实例已初始化

/**
 * 结构化日志记录器
 * 用于在点赞模块中提供统一的日志输出
 */
const logger = {
  info: (message: string, context?: object) => console.log(`ℹ️ [LikesService] ${message}`, context || ''),
  warn: (message: string, context?: object) => console.warn(`⚠️ [LikesService] ${message}`, context || ''),
  error: (message: string, error?: Error, context?: object) => console.error(`❌ [LikesService] ${message}`, context, error ? error.stack : ''),
  success: (message: string, context?: object) => console.log(`✅ [LikesService] ${message}`, context || ''),
};

/**
 * 自定义验证错误类
 */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ====================================================================
// 数据结构假设:
// - 文章点赞: `articleLikes/{userId}_{postId}` 存储用户点赞记录
// - 文章总赞数: `articles/{postId}/likes` 存储文章总点赞计数
// - 评论点赞: `commentLikes/{postId}/{commentId}/{userId}` 存储用户点赞记录
// - 评论直接赞数: `comments/{postId}/{commentId}/likes` 存储评论直接点赞计数
// - 评论总赞数 (包含子评论): `comments/{postId}/{commentId}/totalLikes` 存储评论及其子评论的总赞数
// - 评论父级: `comments/{postId}/{commentId}/parentId` 指向父评论ID (根评论为 '0' 或不存在)
// - 评论子集: `comments/{postId}/{commentId}/children` (可选) 存储 `{ childId: true }`
// ====================================================================


// ====================================================================
// 文章点赞相关功能 (处理文章级别的点赞)
// ====================================================================

/**
 * 用户对文章点赞
 * @param {string} userId - 用户ID
 * @param {string} postId - 文章ID
 * @returns {Promise<{ isNewLike: boolean; likesCount: number; }>} - 返回是否为新点赞及更新后的点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function addArticleLike(userId: string, postId: string): Promise<{ isNewLike: boolean; likesCount: number; }> {
  if (!userId || !postId) {
    throw new ValidationError('userId 和 postId 不能为空');
  }

  const userLikePath = `articleLikes/${userId}_${postId}`;
  const articleLikesCountPath = `articles/${postId}/likes`;

  try {
    // 使用事务确保原子性地增加点赞记录和计数
    let isNewLike = false;
    const likeTransactionResult = await transaction(userLikePath, (currentLike) => {
      if (currentLike) {
        return undefined; // 已点赞，不更新
      }
      isNewLike = true;
      return { userId, postId, createdAt: new Date().toISOString() };
    });

    if (likeTransactionResult && !likeTransactionResult.committed) {
      logger.warn(`用户已点赞此文章 ( userId: ${userId}, postId: ${postId} )`);
      // 获取当前的点赞数并返回
      const currentCount = await read(articleLikesCountPath) || 0;
      return { isNewLike: false, likesCount: currentCount as number };
    }

    // 如果是新点赞，增加文章点赞计数
    await transaction(articleLikesCountPath, (currentCount: number | null) => {
      return (currentCount || 0) + 1;
    });

    const updatedLikesCount = await read(articleLikesCountPath) || 0;
    logger.success(`文章点赞成功 ( userId: ${userId}, postId: ${postId}, likesCount: ${updatedLikesCount} )`);
    return { isNewLike: true, likesCount: updatedLikesCount as number };

  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`添加文章点赞失败 (userId: ${userId}, postId: ${postId}):`, error);
    throw new Error('Failed to add article like');
  }
}

/**
 * 用户取消对文章点赞
 * @param {string} userId - 用户ID
 * @param {string} postId - 文章ID
 * @returns {Promise<{ isRemoved: boolean; likesCount: number; }>} - 返回是否成功移除及更新后的点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function removeArticleLike(userId: string, postId: string): Promise<{ isRemoved: boolean; likesCount: number; }> {
  if (!userId || !postId) {
    throw new ValidationError('userId 和 postId 不能为空');
  }

  const userLikePath = `articleLikes/${userId}_${postId}`;
  const articleLikesCountPath = `articles/${postId}/likes`;

  try {
    let isRemoved = false;
    const likeTransactionResult = await transaction(userLikePath, (currentLike) => {
      if (!currentLike) {
        return undefined; // 未点赞，不更新
      }
      isRemoved = true;
      return null; // 删除点赞记录
    });

    if (likeTransactionResult && !likeTransactionResult.committed) {
      logger.warn(`用户未点赞此文章，无法取消 ( userId: ${userId}, postId: ${postId} )`);
      const currentCount = await read(articleLikesCountPath) || 0;
      return { isRemoved: false, likesCount: currentCount as number };
    }

    // 如果成功移除点赞，减少文章点赞计数
    await transaction(articleLikesCountPath, (currentCount: number | null) => {
      return Math.max(0, (currentCount || 0) - 1); // 确保不为负
    });

    const updatedLikesCount = await read(articleLikesCountPath) || 0;
    logger.success(`文章取消点赞成功 ( userId: ${userId}, postId: ${postId}, likesCount: ${updatedLikesCount} )`);
    return { isRemoved: true, likesCount: updatedLikesCount as number };

  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`移除文章点赞失败 (userId: ${userId}, postId: ${postId}):`, error);
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
export async function getArticleLikesCount(postId: string): Promise<number> {
  if (!postId) {
    throw new ValidationError('postId 不能为空');
  }
  try {
    const likesCount = await read(`articles/${postId}/likes`);
    return typeof likesCount === 'number' ? likesCount : 0;
  } catch (error: unknown) {
    logger.error(`获取文章点赞数失败 (postId: ${postId}):`, error);
    throw new Error('Failed to get article likes count');
  }
}

/**
 * 检查用户是否已点赞某文章
 * @param {string} userId - 用户ID
 * @param {string} postId - 文章ID
 * @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function hasUserLikedArticle(userId: string, postId: string): Promise<boolean> {
  if (!userId || !postId) {
    throw new ValidationError('userId 和 postId 不能为空');
  }
  try {
    const likeRecord = await read(`articleLikes/${userId}_${postId}`);
    return !!likeRecord;
  } catch (error: unknown) {
    logger.error(`检查文章点赞状态失败 (userId: ${userId}, postId: ${postId}):`, error);
    throw new Error('Failed to check article like status');
  }
}

// ====================================================================
// 评论点赞相关功能 (处理评论级别的点赞及总点赞数汇总)
// ====================================================================

/**
 * [性能警告] 计算并更新评论及其子评论的总点赞数 (totalLikes)。
 * 注意：这种递归更新方式可能导致大量读写操作和竞态条件，在大规模深度嵌套场景下效率低下。
 * 强烈建议在生产环境考虑使用 Firebase Cloud Functions 触发器进行异步汇总，以提高可伸缩性。
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @param {number} [depth=0] - 当前递归深度，用于防止无限循环
 * @param {number} [maxRetries=3] - 最大重试次数
 * @returns {Promise<number>} - 更新后的总点赞数
 * @throws {Error} 如果计算失败
 */
async function computeCommentTreeTotalLikes(postId: string, commentId: string, depth: number = 0, maxRetries: number = 3): Promise<number> {
  const MAX_RECURSION_DEPTH = 50;
  if (depth > MAX_RECURSION_DEPTH) {
    logger.warn(`[深度限制] 评论总赞数计算递归深度超过${MAX_RECURSION_DEPTH} ( postId: ${postId}, commentId: ${commentId} )`);
    return 0;
  }

  const commentPath = `comments/${postId}/${commentId}`;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const commentData = await read(commentPath);
      if (!commentData) {
        logger.warn(`评论不存在，无法计算总赞数 ( postId: ${postId}, commentId: ${commentId} )`);
        return 0;
      }

      let currentCommentDirectLikes = commentData.likes || 0; // 当前评论的直接点赞数
      let childrenTotalLikes = 0;

      // Realtime Database 存储子节点通常是对象而非数组
      if (commentData.children && typeof commentData.children === 'object') {
        const childrenIds = Object.keys(commentData.children);
        for (const childId of childrenIds) {
          if (!childId) {
            logger.warn(`无效子评论ID，跳过 ( postId: ${postId}, parentCommentId: ${commentId} )`);
            continue;
          }
          const childTotal = await computeCommentTreeTotalLikes(postId, childId, depth + 1, maxRetries);
          childrenTotalLikes += childTotal;
          // [优化考虑]: 不在这里更新子评论的 totalLikes，而是在其自身被计算时更新
        }
      }

      const newTotalLikes = currentCommentDirectLikes + childrenTotalLikes;

      // 仅当 totalLikes 实际发生变化时才写入，减少不必要的 Writes
      if (commentData.totalLikes !== newTotalLikes) {
        await write(commentPath, { totalLikes: newTotalLikes, lastSync: Date.now() }, { method: 'update' });
        logger.info(`更新评论树总赞数 ( postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes} )`);
      } else {
        logger.info(`评论树总赞数未变化，跳过写入 ( postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes} )`);
      }
      return newTotalLikes;

    } catch (err: unknown) {
      attempt++;
      if (err instanceof Error) {
        logger.error(`计算评论树总赞数失败，尝试 ${attempt}/${maxRetries} ( postId: ${postId}, commentId: ${commentId} )`, err);
      } else {
        logger.error(`计算评论树总赞数失败，尝试 ${attempt}/${maxRetries} ( postId: ${postId}, commentId: ${commentId} )`, new Error(String(err)));
      }
      if (attempt === maxRetries) {
        logger.error(`计算评论树总赞数达到最大重试次数 ( postId: ${postId}, commentId: ${commentId} )`);
        throw new Error('Failed to compute comment tree total likes after multiple retries');
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // 指数退避重试
    }
  }
  return 0; // 如果循环结束仍未成功
}

/**
 * [性能警告] 向上更新祖先评论的 totalLikes。
 * 同 computeCommentTreeTotalLikes，在高并发或深度嵌套评论中应谨慎使用。
 * @param {string} postId - 文章ID
 * @param {string} initialCommentId - 初始评论ID
 * @param {number} [depth=0] - 递归深度
 * @returns {Promise<void>}
 * @throws {Error} 如果更新失败
 */
async function updateCommentAncestorsTotalLikes(postId: string, initialCommentId: string, depth: number = 0): Promise<void> {
  const MAX_ANCESTOR_DEPTH = 50;
  if (depth > MAX_ANCESTOR_DEPTH) {
    logger.warn(`[深度限制] 更新祖先总赞数递归深度超过${MAX_ANCESTOR_DEPTH} ( postId: ${postId}, initialCommentId: ${initialCommentId} )`);
    return;
  }

  let currentCommentId = initialCommentId;
  try {
    while (currentCommentId !== '0' && currentCommentId !== undefined && currentCommentId !== null) { // '0' 用于表示根评论的 parentId
      const commentPath = `comments/${postId}/${currentCommentId}`;
      const comment = await read(commentPath);

      if (!comment) {
        logger.info(`祖先评论不存在或到达评论链顶部 ( postId: ${postId}, commentId: ${currentCommentId} )`);
        break;
      }

      // 重新计算当前评论的 totalLikes，以便其父级可以依赖最新值
      await computeCommentTreeTotalLikes(postId, currentCommentId, depth + 1);
      currentCommentId = comment.parentId; // 移动到下一个祖先
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.error(`更新祖先总赞数失败 ( postId: ${postId}, initialCommentId: ${initialCommentId} ):`, err);
    } else {
      logger.error(`更新祖先总赞数失败 ( postId: ${postId}, initialCommentId: ${initialCommentId} ):`, new Error(String(err)));
    }
    throw new Error('Failed to update ancestor total likes');
  }
}


/**
 * 用户对评论点赞
 * @param {string} userId - 用户ID
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<{ isNewLike: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否为新点赞及更新后的点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function addCommentLike(userId: string, postId: string, commentId: string): Promise<{ isNewLike: boolean; directLikesCount: number; totalLikesCount: number; }> {
  if (!userId || !postId || !commentId) {
    throw new ValidationError('userId, postId, commentId 不能为空');
  }

  const userLikePath = `commentLikes/${postId}/${commentId}/${userId}`;
  const commentDirectLikesPath = `comments/${postId}/${commentId}/likes`;
  const commentTotalLikesPath = `comments/${postId}/${commentId}/totalLikes`;

  try {
    // 1. 检查评论是否存在
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) {
      throw new ValidationError('评论不存在');
    }

    // 2. 使用事务安全地添加点赞记录和增加直接点赞计数
    let isNewLike = false;
    const likeRecordTransactionResult = await transaction(userLikePath, (current) => {
      if (current) {
        return undefined; // 已点赞
      }
      isNewLike = true;
      return { userId, postId, commentId, createdAt: new Date().toISOString() };
    });

    if (likeRecordTransactionResult && !likeRecordTransactionResult.committed) {
      logger.warn(`用户已点赞此评论 ( userId: ${userId}, postId: ${postId}, commentId: ${commentId} )`);
      const directLikes = await read(commentDirectLikesPath) || 0;
      const totalLikes = await read(commentTotalLikesPath) || 0;
      return { isNewLike: false, directLikesCount: directLikes as number, totalLikesCount: totalLikes as number };
    }

    await transaction(commentDirectLikesPath, (currentCount: number | null) => {
      return (currentCount || 0) + 1;
    });

    // 3. 异步更新当前评论及其祖先评论的 totalLikes
    const updatedTotalLikes = await computeCommentTreeTotalLikes(postId, commentId); // 更新当前评论的 totalLikes
    // 异步更新所有祖先评论的 totalLikes，等待其完成后再返回
    await updateCommentAncestorsTotalLikes(postId, commentId);

    const updatedDirectLikes = await read(commentDirectLikesPath) || 0;
    logger.success(`评论点赞成功 ( userId: ${userId}, postId: ${postId}, commentId: ${commentId} )`);
    return { isNewLike: true, directLikesCount: updatedDirectLikes as number, totalLikesCount: updatedTotalLikes };

  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`添加评论点赞失败 (userId: ${userId}, postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to add comment like');
  }
}

/**
 * 用户取消对评论点赞
 * @param {string} userId - 用户ID
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<{ isRemoved: boolean; directLikesCount: number; totalLikesCount: number; }>} - 返回是否成功移除及更新后的点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function removeCommentLike(userId: string, postId: string, commentId: string): Promise<{ isRemoved: boolean; directLikesCount: number; totalLikesCount: number; }> {
  if (!userId || !postId || !commentId) {
    throw new ValidationError('userId, postId, commentId 不能为空');
  }

  const userLikePath = `commentLikes/${postId}/${commentId}/${userId}`;
  const commentDirectLikesPath = `comments/${postId}/${commentId}/likes`;
  const commentTotalLikesPath = `comments/${postId}/${commentId}/totalLikes`;

  try {
    // 1. 检查评论是否存在
    const existingComment = await read(`comments/${postId}/${commentId}`);
    if (!existingComment) {
      throw new ValidationError('评论不存在');
    }

    // 2. 使用事务安全地移除点赞记录和减少直接点赞计数
    let isRemoved = false;
    const likeRecordTransactionResult = await transaction(userLikePath, (current) => {
      if (!current) {
        return undefined; // 未点赞
      }
      isRemoved = true;
      return null; // 删除点赞记录
    });

    if (likeRecordTransactionResult && !likeRecordTransactionResult.committed) {
      logger.warn(`用户未点赞此评论，无法取消 ( userId: ${userId}, postId: ${postId}, commentId: ${commentId} )`);
      const directLikes = await read(commentDirectLikesPath) || 0;
      const totalLikes = await read(commentTotalLikesPath) || 0;
      return { isRemoved: false, directLikesCount: directLikes as number, totalLikesCount: totalLikes as number };
    }

    await transaction(commentDirectLikesPath, (currentCount: number | null) => {
      return Math.max(0, (currentCount || 0) - 1);
    });

    // 3. 异步更新当前评论及其祖先评论的 totalLikes
    const updatedTotalLikes = await computeCommentTreeTotalLikes(postId, commentId); // 更新当前评论的 totalLikes
    await updateCommentAncestorsTotalLikes(postId, commentId); // 异步更新所有祖先评论的 totalLikes

    const updatedDirectLikes = await read(commentDirectLikesPath) || 0;
    logger.success(`评论取消点赞成功 ( userId: ${userId}, postId: ${postId}, commentId: ${commentId} )`);
    return { isRemoved: true, directLikesCount: updatedDirectLikes as number, totalLikesCount: updatedTotalLikes };

  } catch (error: unknown) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`移除评论点赞失败 (userId: ${userId}, postId: ${postId}, commentId: ${commentId}):`, error);
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
export async function getCommentDirectLikesCount(postId: string, commentId: string): Promise<number> {
  if (!postId || !commentId) {
    throw new ValidationError('postId 和 commentId 不能为空');
  }
  try {
    const likesCount = await read(`comments/${postId}/${commentId}/likes`);
    return typeof likesCount === 'number' ? likesCount : 0;
  } catch (error: unknown) {
    logger.error(`获取评论直接点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
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
export async function getCommentTotalLikesCount(postId: string, commentId: string): Promise<number> {
  if (!postId || !commentId) {
    throw new ValidationError('postId 和 commentId 不能为空');
  }
  try {
    const totalLikesCount = await read(`comments/${postId}/${commentId}/totalLikes`);
    return typeof totalLikesCount === 'number' ? totalLikesCount : 0;
  } catch (error: unknown) {
    logger.error(`获取评论总点赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to get comment total likes count');
  }
}

/**
 * 检查用户是否已点赞某评论
 * @param {string} userId - 用户ID
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<boolean>} - 如果用户已点赞返回 true，否则返回 false
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function hasUserLikedComment(userId: string, postId: string, commentId: string): Promise<boolean> {
  if (!userId || !postId || !commentId) {
    throw new ValidationError('userId, postId, commentId 不能为空');
  }
  try {
    const likeRecord = await read(`commentLikes/${postId}/${commentId}/${userId}`);
    return !!likeRecord;
  } catch (error: unknown) {
    logger.error(`检查评论点赞状态失败 (userId: ${userId}, postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to check comment like status');
  }
}

// ====================================================================
// 默认导出的 HTTP API 接口函数 (为 api/index.js 调用而设计)
// ====================================================================

/**
 * 默认导出的 HTTP API 接口函数。
 * 处理所有点赞相关的 HTTP 请求，并分发到内部的业务逻辑函数。
 * @param {Request} req - HTTP请求对象，Vercel环境下的Web标准Request对象
 * @param {Response} res - HTTP响应对象，Vercel环境下的Web标准Response对象
 * @returns {Promise<Response>} - 包含操作结果的HTTP响应
 */
export default async function likeApiHandler(req: Request, res: Response): Promise<Response> {
  // 设置 CORS 头，处理预检请求
  setCORS(res, req); // 使用从 utils.js 导入的 setCORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: res.headers });
  }

  let body: any = {};
  try {
    body = await parseBody(req); // 使用从 utils.js 导入的 parseBody
  } catch (parseError: any) {
    logger.error('请求体解析失败', parseError);
    return new Response(JSON.stringify({ success: false, message: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });
  }

  const { type, action, userId, postId, commentId } = body; // 假设请求体中包含这些关键信息

  if (!type || !action || !userId || !postId) {
    logger.warn('缺少必要参数: type, action, userId, postId');
    return new Response(JSON.stringify({ success: false, message: 'Missing required parameters: type, action, userId, postId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });
  }

  try {
    let result: any;
    switch (type) {
      case 'article':
        switch (action) {
          case 'add':
            result = await addArticleLike(userId, postId);
            logger.success(`文章点赞 API 调用成功 (userId: ${userId}, postId: ${postId})`);
            break;
          case 'remove':
            result = await removeArticleLike(userId, postId);
            logger.success(`文章取消点赞 API 调用成功 (userId: ${userId}, postId: ${postId})`);
            break;
          case 'get_count':
            result = await getArticleLikesCount(postId);
            logger.success(`获取文章点赞数 API 调用成功 (postId: ${postId})`);
            break;
          case 'has_liked':
            result = await hasUserLikedArticle(userId, postId);
            logger.success(`检查文章点赞状态 API 调用成功 (userId: ${userId}, postId: ${postId})`);
            break;
          default:
            throw new ValidationError(`Unsupported action for article: ${action}`);
        }
        break;

      case 'comment':
        if (!commentId) {
          throw new ValidationError('commentId is required for comment actions');
        }
        switch (action) {
          case 'add':
            result = await addCommentLike(userId, postId, commentId);
            logger.success(`评论点赞 API 调用成功 (userId: ${userId}, postId: ${postId}, commentId: ${commentId})`);
            break;
          case 'remove':
            result = await removeCommentLike(userId, postId, commentId);
            logger.success(`评论取消点赞 API 调用成功 (userId: ${userId}, postId: ${postId}, commentId: ${commentId})`);
            break;
          case 'get_direct_count':
            result = await getCommentDirectLikesCount(postId, commentId);
            logger.success(`获取评论直接点赞数 API 调用成功 (postId: ${postId}, commentId: ${commentId})`);
            break;
          case 'get_total_count':
            result = await getCommentTotalLikesCount(postId, commentId);
            logger.success(`获取评论总点赞数 API 调用成功 (postId: ${postId}, commentId: ${commentId})`);
            break;
          case 'has_liked':
            result = await hasUserLikedComment(userId, postId, commentId);
            logger.success(`检查评论点赞状态 API 调用成功 (userId: ${userId}, postId: ${postId}, commentId: ${commentId})`);
            break;
          // [可选] 暴露computeCommentTreeTotalLikes等用于特殊调试或后台场景
          // case 'recompute_total':
          //   result = await computeCommentTreeTotalLikes(postId, commentId);
          //   break;
          default:
            throw new ValidationError(`Unsupported action for comment: ${action}`);
        }
        break;

      default:
        throw new ValidationError(`Unsupported resource type: ${type}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });

  } catch (error: any) {
    logger.error('点赞API处理失败', error, { type, action, userId, postId, commentId });
    const status = error.name === 'ValidationError' ? 400 : 500;
    return new Response(JSON.stringify({ success: false, message: error.message || 'Internal server error' }), {
      status: status,
      headers: { 'Content-Type': 'application/json', ...res.headers },
    });
  }
}

// 导出所有功能函数
export {
  addArticleLike,
  removeArticleLike,
  getArticleLikesCount,
  hasUserLikedArticle,
  addCommentLike,
  removeCommentLike,
  getCommentDirectLikesCount,
  getCommentTotalLikesCount,
  hasUserLikedComment,
  computeCommentTreeTotalLikes, // 也可以选择不导出，仅供内部使用
  updateCommentAncestorsTotalLikes, // 也可以选择不导出，仅供内部使用
  ValidationError
};
