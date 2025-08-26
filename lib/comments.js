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
* 提交新评论。
* 顶层评论 (parentId='0') 会获得递增的楼层号 (floor)，子评论则无楼层号。
* @param {object} commentData - 评论数据对象
* @param {string} commentData.postId - 文章ID
* @param {string} commentData.name - 评论者姓名 (对于登录用户，通常是 username)
* @param {string} commentData.email - 评论者邮箱
* @param {string} commentData.content - 评论内容
* @param {string} [commentData.parentId='0'] - 父评论ID ('0' for top-level comments)
* @param {boolean} [commentData.isGuest=true] - Flag indicating if the comment is from a guest.
* @returns {Promise<object>} - 提交成功的评论数据 (包含新分配的 floor)
* @throws {ValidationError} 如果输入验证失败
* @throws {Error} 如果数据库操作失败
*/
export async function addComment(commentData) {
  const { postId, name, email, content, parentId = '0', isGuest = true } = commentData;

  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!validateInput(name, 'name')) throw new ValidationError('评论者姓名无效 (需1-50字符)');
  if (email && !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (!content || content.trim().length === 0 || !validateInput(content, 'comment')) throw new ValidationError('评论内容不能为空且长度需在1-500字符之间');

  const commentsPath = `comments/${postId}`;
  const metadataPath = `comments/${postId}/metadata/floorCounter`;

  try {
    // --- 2. Check Parent Comment Existence (if not a top-level comment) ---
    if (parentId !== '0') {
      const parentComment = await read(`${commentsPath}/${parentId}`);
      if (!parentComment) {
        throw new ValidationError('父评论不存在');
      }
    }

    // --- 3. Generate New Comment ID ---
    const newRef = await write(commentsPath, null, { method: 'push' });
    const commentId = newRef.key;
    let newFloorValue = null; // Default floor to null (for replies)

    // --- 4. Handle Floor Numbering for Top-Level Comments ---
    if (parentId === '0') {
      const transactionResult = await transaction(metadataPath, function(currentMetadata) {
        const currentCounter = currentMetadata?.counter || 0;
        newFloorValue = currentCounter + 1; // Assign the next floor number
        return { counter: newFloorValue }; // Update the counter for the next comment
      });
      if (!transactionResult.committed) {
        logger.warn(`[CommentsLib] addComment: 楼层计数器事务未成功提交，可能存在并发冲突 (postId: ${postId})`);
      }
    }

    // --- 5. Construct Full Comment Data ---
    const fullCommentData = {
      id: commentId,
      name: name.trim(), // Trim whitespace from name
      email: email ? email.trim() : null, // Trim whitespace from email, or null if not provided
      content: content.trim(), // Trim whitespace from content
      createdAt: new Date().toISOString(), // Timestamp for creation
      updatedAt: new Date().toISOString(), // Timestamp for last update
      likes: 0,              // Initial direct likes count
      totalLikes: 0,         // Initial total likes (including children)
      parentId: parentId,    // Link to parent comment or '0' for top-level
      floor: newFloorValue,  // Assigned floor number (null for replies)
      isGuest,               // Flag for guest comments
      children: {}           // Placeholder for children references (if needed by backend)
    };

    // --- 6. Write the New Comment Data ---
    await write(`${commentsPath}/${commentId}`, fullCommentData, { method: 'set' });

    // --- 7. Update Parent's Children List and Ancestor Likes (if it's a reply) ---
    if (parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${parentId}/children`;
      // Atomically update the parent's children map
      await transaction(parentChildrenPath, function(currentChildren) {
        const childrenMap = currentChildren || {};
        childrenMap[commentId] = true; // Add reference to the new child comment
        return childrenMap;
      });
      // Asynchronously update totalLikes for parent and ancestors
      try {
        await computeCommentTreeTotalLikes({ postId, commentId: parentId }); // Update parent's direct likes count first
        await updateCommentAncestorsTotalLikes({ postId, initialCommentId: parentId }); // Then update ancestors
      } catch (asyncError) {
        logger.error(`[CommentsLib] addComment: 异步更新祖先总赞数失败 (postId: ${postId}, parentId: ${parentId})`, asyncError);
      }
    }

    logger.info(`[CommentsLib] addComment: 评论添加成功 (postId: ${postId}, commentId: ${commentId}, floor: ${newFloorValue || 'Reply'})`);
    return fullCommentData;

  } catch (error) {
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    logger.error(`[CommentsLib] addComment: 添加评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to add comment.'); // General error
  }
}

/**
* 获取文章的所有评论，并以树形结构返回。
* @param {object} data - 包含 postId 的对象
* @param {string} data.postId - 文章ID
* @returns {Promise<object[]>} - 评论树数组，每个评论对象包含其子评论数组。
* @throws {ValidationError} 如果输入无效
* @throws {Error} 如果数据库操作失败
*/
export async function getComments({ postId }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) {
    logger.warn(`[CommentsLib] getComments: 无效的 postId (postId: ${postId})`);
    throw new ValidationError('Invalid postId provided.');
  }

  const commentsPath = `comments/${postId}`;
  try {
    const commentsData = await read(commentsPath); // Read all comments for the post

    // If no comments exist for the post, return an empty array
    if (!commentsData) {
      logger.info(`[CommentsLib] getComments: 无评论数据 (postId: ${postId})`);
      return [];
    }

    const commentsMap = {}; // Map to store comments by ID for easy lookup
    // Process raw data into a more usable map format
    Object.values(commentsData).forEach(function(c) {
      // Basic validation for each comment entry
      if (!c || !c.id || !c.createdAt || !c.name || !c.content) { // Use c.name for consistency
        logger.warn(`[CommentsLib] getComments: 无效评论数据，已跳过 (postId: ${postId}, commentId: ${c?.id})`, c);
        return; // Skip invalid comment entries
      }
      // Normalize data structure
      c.children = c.children && typeof c.children === 'object' ? c.children : {}; // Ensure children is an object
      c.likes = typeof c.likes === 'number' ? c.likes : 0; // Ensure likes is a number
      c.totalLikes = typeof c.totalLikes === 'number' ? c.totalLikes : 0; // Ensure totalLikes is a number
      c.parentId = c.parentId || '0'; // Default parentId to '0' if not present
      commentsMap[c.id] = c; // Store comment in the map
    });

    const rootComments = []; // Array to hold top-level comments
    // Build the tree structure
    Object.values(commentsMap).forEach(function(comment) {
      if (comment.parentId === '0') {
        rootComments.push(comment); // Add top-level comments to the root array
      } else {
        const parent = commentsMap[comment.parentId];
        if (parent) {
          // If parent exists, add this comment to its children array
          if (!parent._childrenArray) {
            parent._childrenArray = []; // Initialize children array if it doesn't exist
          }
          parent._childrenArray.push(comment);
        } else {
          // If parent comment doesn't exist (orphaned comment), add it to root comments
          logger.warn(`[CommentsLib] getComments: 孤立评论 (postId: ${postId}, commentId: ${comment.id})，归入顶层`);
          rootComments.push(comment);
        }
      }
    });

    // Recursive function to finalize the tree structure: sort children and convert from object/array to array
    function buildCommentTree(comments) {
      // FIX: Sort comments by updatedAt, latest at the end (ascending order)
      comments.sort(function(a, b) {
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return dateA - dateB; // Ascending order
      });
      // Process each comment's children
      comments.forEach(function(c) {
        if (c._childrenArray) {
          c.children = buildCommentTree(c._childrenArray); // Recursively build tree for children
          delete c._childrenArray; // Clean up temporary array
        } else {
          c.children = []; // Ensure children property is always an array
        }
      });
      return comments;
    }

    const tree = buildCommentTree(rootComments); // Build the final comment tree
    logger.info(`[CommentsLib] getComments: 成功获取评论数据 (postId: ${postId}, topLevelCount: ${tree.length})`);
    return tree; // Return the structured comment tree

  } catch (error) {
    logger.error(`[CommentsLib] getComments: 获取评论失败 (postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    throw new Error('Failed to fetch comments.'); // General error
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
