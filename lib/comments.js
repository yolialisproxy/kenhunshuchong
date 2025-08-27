// lib/comments.js - 终极优化版：移除TS，添加重试，统一Response (修复所有已知问题)
import {
  read, write, del, transaction, initFirebase, logger, computeTotalLikes, validateInput, ValidationError, CONFIG
} from '../lib/utils.js'; // Ensure all necessary utilities are imported, added CONFIG

// Logger initialization consistency
logger.info('✅ lib/comments.js 加载成功');

// Initialize Firebase database instance on module load
initFirebase();

// ====================================================================
// 评论辅助功能 (例如总赞数计算和祖先更新)
// ====================================================================

/**
* 计算并更新评论及其子评论的总点赞数 (totalLikes)。
* 此函数调用 utils.js 中的核心计算逻辑，然后将结果持久化到数据库。
* 注意：此递归方式在大规模深度嵌套场景下效率低下，建议异步触发。
* @param {object} data - 包含 postId 和 commentId 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 评论ID
* @returns {Promise<number>} - 更新后的总点赞数
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果计算或写入失败
*/
export async function computeCommentTreeTotalLikes({ postId, commentId }) {
  // Validate inputs first
  if (!postId || !validateInput(postId, 'id')) {
    logger.warn(`[CommentsLib] computeCommentTreeTotalLikes: 无效的 postId (postId: ${postId})`);
    throw new ValidationError('Invalid postId provided.');
  }
  if (!commentId || !validateInput(commentId, 'id')) {
    logger.warn(`[CommentsLib] computeCommentTreeTotalLikes: 无效的 commentId (commentId: ${commentId})`);
    throw new ValidationError('Invalid commentId provided.');
  }

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath); // Read the comment data
    if (!commentData) {
      logger.warn(`[CommentsLib] computeCommentTreeTotalLikes: 评论不存在，无法更新总赞数 (postId: ${postId}, commentId: ${commentId})`);
      return 0;
    }

    // The `computeTotalLikes` in utils.js will handle the recursion.
    const newTotalLikes = await computeTotalLikes(postId, commentId); // Call the core utility function

    // Only write to DB if the totalLikes count has actually changed
    if (commentData.totalLikes !== newTotalLikes) {
      await write(commentPath, { totalLikes: newTotalLikes, lastSync: new Date().toISOString() }, { method: 'update' });
      logger.info(`[CommentsLib] computeCommentTreeTotalLikes: 更新评论树总赞数 (postId: ${postId}, commentId: ${commentId}, newTotalLikes: ${newTotalLikes})`);
    } else {
      logger.info(`[CommentsLib] computeCommentTreeTotalLikes: 评论树总赞数未变化，跳过写入 (postId: ${postId})`);
    }
    return newTotalLikes; // Return the calculated total likes
  } catch (error) {
    logger.error(`[CommentsLib] computeCommentTreeTotalLikes: 计算并更新评论树总赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to compute and update comment tree total likes.'); // General error
  }
}

/**
* 向上更新祖先评论的 totalLikes，直到根评论。
* @param {object} data - 包含 postId 和 initialCommentId 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.initialCommentId - 初始评论ID (通常是刚被操作的评论)
* @returns {Promise<void>}
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果更新失败
*/
export async function updateCommentAncestorsTotalLikes({ postId, initialCommentId }) {
  let currentCommentId = initialCommentId;
  const MAX_TRAVERSAL_DEPTH = 20; // Limit traversal depth to prevent infinite loops or stack overflow
  let traversalCount = 0;

  try {
    // Traverse up the comment chain
    while (currentCommentId && currentCommentId !== '0' && traversalCount < MAX_TRAVERSAL_DEPTH) {
      const commentPath = `comments/${postId}/${currentCommentId}`;
      const comment = await read(commentPath); // Read the current ancestor comment

      if (!comment || !comment.parentId) { // Stop if comment not found or it's a top-level comment (parentId === '0')
        logger.info(`[CommentsLib] updateCommentAncestorsTotalLikes: 到达评论链顶部或评论不存在，停止遍历 (postId: ${postId}, currentCommentId: ${currentCommentId})`);
        break;
      }

      // Trigger the calculation and update for the current ancestor comment
      await computeCommentTreeTotalLikes({ postId, commentId: currentCommentId });

      currentCommentId = comment.parentId; // Move to the parent comment
      traversalCount++;
    }
    if (traversalCount >= MAX_TRAVERSAL_DEPTH) {
      logger.warn(`[CommentsLib] updateCommentAncestorsTotalLikes: 达到最大遍历深度 ${MAX_TRAVERSAL_DEPTH} (postId: ${postId}, initialCommentId: ${initialCommentId})`);
    }
  } catch (error) {
    logger.error(`[CommentsLib] updateCommentAncestorsTotalLikes: 更新祖先总赞数失败 (postId: ${postId}, initialCommentId: ${initialCommentId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to update ancestor total likes.'); // General error
  }
}

// ====================================================================
// 核心评论操作功能
// ====================================================================

/**
* 添加新评论。
* @param {object} data - 评论数据
* @param {string} data.postId - 文章ID
* @param {string} data.name - 评论者名称 (用户名或游客名)
* @param {string} data.email - 评论者邮箱
* @param {string} data.content - 评论内容
* @param {string} [data.parentId='0'] - 父评论ID，'0' 表示顶层评论
* @param {boolean} [data.isGuest=true] - 是否为游客评论
* @returns {Promise<object>} - 新评论数据
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function addComment({ postId, name, email, content, parentId = '0', isGuest = true }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!name || !validateInput(name, 'name')) throw new ValidationError('评论者名称无效 (1-50字符)');
  if (!email || !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (!content || !validateInput(content, 'comment')) throw new ValidationError('评论内容无效 (1-500字符)');
  if (!validateInput(parentId, 'id')) throw new ValidationError('无效的 parentId');

  const commentId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5); // Unique ID
  const commentPath = `comments/${postId}/${commentId}`;
  const parentCommentPath = `comments/${postId}/${parentId}`;

  try {
    // --- 2. Check Parent Comment Existence (if not top-level) ---
    if (parentId !== '0') {
      const parentCommentExists = await read(parentCommentPath);
      if (!parentCommentExists) {
        logger.warn(`[CommentsLib] addComment: 父评论不存在，无法回复 (postId: ${postId}, parentId: ${parentId})`);
        throw new ValidationError('父评论不存在，无法回复');
      }
    }

    // --- 3. Determine Floor Number for Top-Level Comments ---
    let floor = null;
    if (parentId === '0') {
      const allComments = await read(`comments/${postId}`);
      const topLevelComments = Object.values(allComments || {}).filter(c => c.parentId === '0');
      floor = topLevelComments.length + 1;
    }

    const newComment = {
      id: commentId,
      postId: postId,
      name: name,
      email: email,
      content: content,
      parentId: parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0, // Direct likes for this comment
      totalLikes: 0, // Total likes including children
      isGuest: isGuest,
      floor: floor, // Only for top-level comments
      replies: [] // Initialize replies array for tree structure
    };

    // --- 4. Atomically write new comment and update parent's children list ---
    await transaction(commentPath, (current) => {
      if (current) return undefined; // Comment ID already exists, abort
      return newComment;
    });

    if (parentId !== '0') {
      // Add to parent's children list (if parentId is not '0')
      await transaction(`${parentCommentPath}/children/${commentId}`, (current) => {
        if (current) return undefined; // Child already exists, abort
        return true; // Just a flag to indicate existence
      });
    }

    // --- 5. Recalculate totalLikes for this comment and its ancestors ---
    // Initially, a new comment has 0 direct likes and 0 children likes, so totalLikes is 0.
    // This will be updated when likes are added.
    // However, we need to ensure the parent's totalLikes are updated if this new comment has any likes (which it doesn't initially).
    // The `computeCommentTreeTotalLikes` and `updateCommentAncestorsTotalLikes` are usually triggered by like/unlike actions.
    // For a new comment, its totalLikes is 0, so no ancestor update is strictly needed *yet* for likes.
    // But if we want to ensure the `totalLikes` field is always accurate, even if 0, we can trigger it.
    // For now, let's assume totalLikes will be correctly updated when likes are added.

    logger.info(`[CommentsLib] 添加评论成功 (postId: ${postId}, commentId: ${commentId}, parentId: ${parentId})`);
    return newComment;

  } catch (error) {
    logger.error(`[CommentsLib] 添加评论失败 (postId: ${postId}, parentId: ${parentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to add comment.'); // General error
  }
}

/**
 * 递归构建评论树的内部辅助函数。
 * @param {string} postId - 文章ID
 * @param {object} allCommentsMap - 包含所有评论的扁平化映射 (commentId -> commentData)
 * @param {object} userLikesMap - 当前用户点赞的评论ID映射 (commentId -> true)
 * @param {string} parentId - 当前层级的父评论ID ('0' 表示顶层评论)
 * @returns {Promise<Array<object>>} - 当前父评论下的子评论树数组
 */
async function _buildCommentTreeRecursive(postId, allCommentsMap, userLikesMap, parentId = '0') {
    const children = Object.values(allCommentsMap).filter(
        comment => comment.parentId === parentId
    ).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); // 按创建时间升序排序

    const commentTreeNodes = [];
    for (const child of children) {
        const childNode = { ...child };
        // 注入用户点赞状态
        childNode.hasLiked = !!userLikesMap[child.id];
        // 递归获取子评论
        childNode.replies = await _buildCommentTreeRecursive(postId, allCommentsMap, userLikesMap, child.id);
        commentTreeNodes.push(childNode);
    }
    return commentTreeNodes;
}

/**
 * 获取文章的所有评论，并构建成树形结构。
 * @param {object} data - 包含 postId, userId, isGuest 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} [data.userId] - 当前登录用户ID，用于检查点赞状态
 * @param {boolean} [data.isGuest] - 是否为游客
 * @returns {Promise<Array<object>>} - 评论树数组
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getComments({ postId, userId, isGuest }) {
    if (!postId || !validateInput(postId, 'id')) {
        throw new ValidationError('无效的 postId');
    }

    const commentsPath = `comments/${postId}`;
    try {
        const allCommentsMap = await read(commentsPath); // 获取所有评论的扁平化映射
        if (!allCommentsMap) {
            logger.info(`[CommentsLib] 文章没有评论 (postId: ${postId})`);
            return [];
        }

        let userLikesMap = {};
        // 如果用户已登录，获取其对该文章所有评论的点赞状态
        if (userId && !isGuest) {
            const userLikesRaw = await read(`commentLikes`); // 获取所有用户的点赞记录
            if (userLikesRaw) {
                for (const key in userLikesRaw) {
                    // 筛选出当前用户对当前文章的点赞
                    if (key.startsWith(`${userId}_${postId}_`)) {
                        const commentId = key.split('_')[2];
                        userLikesMap[commentId] = true;
                    }
                }
            }
            logger.debug(`[CommentsLib] 用户 ${userId} 对文章 ${postId} 的点赞状态:`, userLikesMap);
        }

        // 构建评论树，并注入点赞状态
        const commentTree = await _buildCommentTreeRecursive(postId, allCommentsMap, userLikesMap, '0'); // '0' 是顶层评论的 parentId
        logger.info(`[CommentsLib] 成功获取评论树 (postId: ${postId}, userId: ${userId || 'Guest'})`);
        return commentTree;

    } catch (error) {
        logger.error(`[CommentsLib] 获取评论树失败 (postId: ${postId}):`, error);
        if (error instanceof ValidationError) throw error;
        throw new Error('Failed to get comments tree.');
    }
}

/**
 * 更新评论内容。
 * 只有评论作者或管理员可以编辑。
 * @param {object} data - 包含 postId, commentId, content, username, adminUsername 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 待更新评论ID
 * @param {string} data.content - 新的评论内容
 * @param {string} data.username - 当前操作用户的用户名
 * @param {string} [data.adminUsername] - 管理员用户名 (从 CONFIG 获取)
 * @returns {Promise<object>} - 更新后的评论数据
 * @throws {ValidationError} 如果输入无效、评论不存在或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function updateComment({ postId, commentId, content, username, adminUsername = CONFIG.ADMIN_USERNAME }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!content || content.trim().length === 0 || !validateInput(content, 'comment')) throw new ValidationError('评论内容不能为空且长度需在1-500字符之间');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const existingComment = await read(commentPath);
    if (!existingComment) {
      logger.warn(`[CommentsLib] updateComment: 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
      throw new ValidationError('评论不存在');
    }

    // --- 2. Authorization Check ---
    const isAuthor = existingComment.name === username; // Use comment.name for author check
    const isAdmin = username === adminUsername;

    if (!isAuthor && !isAdmin) {
      logger.warn(`[CommentsLib] updateComment: 无权限编辑评论 (username: ${username}, commentId: ${commentId})`);
      throw new ValidationError('您无权编辑此评论');
    }

    // --- 3. Update Comment Data ---
    const updatedData = {
      content: content.trim(),
      updatedAt: new Date().toISOString()
    };
    await write(commentPath, updatedData, { method: 'update' });

    logger.info(`[CommentsLib] updateComment: 评论更新成功 (postId: ${postId}, commentId: ${commentId})`);
    // Fetch and return the updated comment
    const updatedComment = await read(commentPath);
    return updatedComment;

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`[CommentsLib] updateComment: 更新评论失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to update comment.');
  }
}

/**
* 删除评论及其所有子评论。
* @param {object} data - 包含 postId, commentId, username 和 adminUsername 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 待删除评论ID
* @param {string} data.username - 当前操作用户的用户名
* @param {string} [data.adminUsername] - 管理员用户名 (从 CONFIG 获取)
* @returns {Promise<object>} - 删除结果
* @throws {ValidationError} 如果输入无效、评论不存在或无权限
* @throws {Error} 如果数据库操作失败
*/
export async function deleteComment({ postId, commentId, username, adminUsername = CONFIG.ADMIN_USERNAME }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('无效的用户名');

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const existingComment = await read(commentPath);
    if (!existingComment) {
      logger.warn(`[CommentsLib] deleteComment: 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
      throw new ValidationError('评论不存在');
    }

    // --- 2. Authorization Check ---
    const isAuthor = existingComment.name === username; // Use comment.name for author check
    const isAdmin = username === adminUsername;

    // Only admin can delete any comment, or author can delete their own
    if (!isAuthor && !isAdmin) {
      logger.warn(`[CommentsLib] deleteComment: 无权限删除评论 (username: ${username}, commentId: ${commentId})`);
      throw new ValidationError('您无权删除此评论');
    }

    // --- 3. Recursively Delete Children ---
    if (existingComment.children && Object.keys(existingComment.children).length > 0) {
      for (const childId of Object.keys(existingComment.children)) {
        // Recursive call, passing current user's username for authorization check at each level
        await deleteComment({ postId, commentId: childId, username, adminUsername });
      }
    }

    // --- 4. Remove Comment from Parent's Children List (if it has a parent) ---
    if (existingComment.parentId && existingComment.parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${existingComment.parentId}/children`;
      await transaction(parentChildrenPath, function(currentChildren) {
        const childrenMap = currentChildren || {};
        delete childrenMap[commentId]; // Remove reference to the deleted child
        return childrenMap;
      });
      // After removing from parent's children, update parent's total likes
      try {
        await computeCommentTreeTotalLikes({ postId, commentId: existingComment.parentId });
        await updateCommentAncestorsTotalLikes({ postId, initialCommentId: existingComment.parentId });
      } catch (asyncError) {
        logger.error(`[CommentsLib] deleteComment: 异步更新祖先总赞数失败 (postId: ${postId}, parentId: ${existingComment.parentId})`, asyncError);
      }
    }

    // --- 5. Delete the Comment Itself ---
    await del(commentPath);

    logger.info(`[CommentsLib] deleteComment: 评论及其子评论删除成功 (postId: ${postId}, commentId: ${commentId})`);
    return { success: true, message: `Comment ${commentId} and its children deleted.` };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`[CommentsLib] deleteComment: 删除评论失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to delete comment.');
  }
}
