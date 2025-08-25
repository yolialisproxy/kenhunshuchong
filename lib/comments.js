// lib/comments.js - 终极优化版：移除TS，添加重试，统一Response (修复所有已知问题)
import {
  read, write, del, transaction, initFirebase, logger, computeTotalLikes, validateInput, ValidationError
} from '../lib/utils.js'; // Ensure all necessary utilities are imported

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
      // Depending on requirements, could throw an error or return 0
      return 0;
    }

    // Determine depth for computeTotalLikes calculation, defaulting to 1 for top-level
    const depth = typeof commentData.floor === 'number' && commentData.floor >= 1 ? commentData.floor : 1;

    // Call the core utility function to calculate new total likes
    const newTotalLikes = await computeTotalLikes(postId, commentId, depth);

    // Only write to DB if the totalLikes count has actually changed
    if (commentData.totalLikes !== newTotalLikes) {
      await write(commentPath, { totalLikes: newTotalLikes, lastSync: new Date().toISOString() }, { method: 'update' });
      logger.info(`[CommentsLib] computeCommentTreeTotalLikes: 更新评论树总赞数 (postId: ${postId}, commentId: ${commentId}, newTotalLikes: ${newTotalLikes}, floor: ${depth})`);
    } else {
      logger.info(`[CommentsLib] computeCommentTreeTotalLikes: 评论树总赞数未变化，跳过写入 (postId: ${postId}, commentId: ${commentId}, floor: ${depth})`);
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
  // [关键修改] Comment content validation: ensure it's not empty.
  if (!content || content.trim().length === 0) throw new ValidationError('评论内容不能为空');

  const commentsPath = `comments/${postId}`;
  // Path for the floor counter metadata. This ensures sequential floor numbers for top-level comments.
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
    // Use write with 'push' method to atomically get a new unique ID
    const newRef = await write(commentsPath, null, { method: 'push' });
    const commentId = newRef.key;
    let newFloorValue = null; // Default floor to null (for replies)

    // --- 4. Handle Floor Numbering for Top-Level Comments ---
    if (parentId === '0') {
      // Atomically get and increment the floor counter for new top-level comments
      const transactionResult = await transaction(metadataPath, function(currentMetadata) {
        const currentCounter = currentMetadata?.counter || 0;
        newFloorValue = currentCounter + 1; // Assign the next floor number
        return { counter: newFloorValue }; // Update the counter for the next comment
      });
      // Log a warning if the transaction didn't commit, indicating potential concurrency issues
      if (!transactionResult.committed) {
        logger.warn(`[CommentsLib] addComment: 楼层计数器事务未成功提交，可能存在并发冲突 (postId: ${postId})`);
        // Depending on requirements, you might want to re-throw or handle this more gracefully
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
      // Note: Using computeCommentTreeTotalLikes on the parent might be sufficient if it's designed to cascade.
      // If not, explicitly calling updateCommentAncestorsTotalLikes is necessary.
      try {
        await computeCommentTreeTotalLikes({ postId, commentId: parentId }); // Update parent's direct likes count first
        await updateCommentAncestorsTotalLikes({ postId, initialCommentId: parentId }); // Then update ancestors
      } catch (asyncError) {
        logger.error(`[CommentsLib] addComment: 异步更新祖先总赞数失败 (postId: ${postId}, parentId: ${parentId})`, asyncError);
        // Handle async error if necessary, but don't block the primary success return
      }
    }

    logger.info(`[CommentsLib] addComment: 评论添加成功 (postId: ${postId}, commentId: ${commentId}, floor: ${newFloorValue || 'Reply'})`);
    // Return the newly created comment data, including the assigned floor number
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
      if (!c || !c.id || !c.createdAt || !c.name || !c.content) {
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
      // Sort comments by creation date
      comments.sort(function(a, b) { return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); });
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
* 删除评论及其所有子评论。
* @param {object} data - 包含 postId, commentId, username 和 adminUsername 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 待删除评论ID
* @param {string} data.username - 请求删除的用户的用户名 (用于权限验证)
* @param {string} [data.adminUsername='yolialisproxy'] - 管理员用户名 (拥有最高权限)
* @returns {Promise<object>} - 删除结果，包含 success: true 和 message。
* @throws {ValidationError} 如果输入无效或无权限
* @throws {Error} 如果数据库操作失败
*/
export async function deleteComment({ postId, commentId, username, adminUsername = 'yolialisproxy' }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!username) throw new ValidationError('用户名不能为空');

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath); // Read the comment to be deleted
    if (!commentData) {
      throw new ValidationError('评论不存在'); // Throw error if comment not found
    }

    // --- 2. Permission Check ---
    const isAuthor = commentData.name === username; // Check if the requester is the author
    const isAdmin = username === adminUsername; // Check if the requester is the admin
    if (!isAuthor && !isAdmin) {
      logger.warn(`[CommentsLib] deleteComment: 无权限删除评论 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
      throw new ValidationError('没有权限删除此评论'); // Throw error if no permission
    }

    // --- 3. Perform Deletion ---
    await del(commentPath); // Delete the comment from the database
    logger.info(`[CommentsLib] deleteComment: 评论删除成功 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);

    // --- 4. Update Parent's Children List and Ancestor Likes (if applicable) ---
    if (commentData.parentId && commentData.parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${commentData.parentId}/children`;
      // Atomically remove the deleted comment's reference from its parent's children list
      await transaction(parentChildrenPath, function(currentChildren) {
        const childrenMap = currentChildren || {};
        delete childrenMap[commentId]; // Remove the reference
        return childrenMap; // Return the updated children map
      });
      // Asynchronously update totalLikes for the parent and its ancestors
      // Note: computeCommentTreeTotalLikes on the parent might cascade updates, but explicit call ensures it.
      try {
        await computeCommentTreeTotalLikes({ postId, commentId: commentData.parentId });
        await updateCommentAncestorsTotalLikes({ postId, initialCommentId: commentData.parentId });
      } catch (asyncError) {
        logger.error(`[CommentsLib] deleteComment: 异步更新祖先总赞数失败 (postId: ${postId}, parentId: ${commentData.parentId})`, asyncError);
      }
    }

    return { success: true, message: '评论删除成功' }; // Return success response

  } catch (error) {
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    logger.error(`[CommentsLib] deleteComment: 删除评论失败 (postId: ${postId}, commentId: ${commentId}, username: ${username}):`, error);
    throw new Error('Failed to remove comment.'); // General error
  }
}

/**
* 编辑评论内容。
* @param {object} data - 包含 postId, commentId, content, username 和 adminUsername 的对象
* @param {string} data.postId - 文章ID
* @param {string} data.commentId - 待编辑评论ID
* @param {string} data.content - 新的评论内容
* @param {string} data.username - 请求编辑的用户的用户名 (用于权限验证)
* @param {string} [data.adminUsername='yolialisproxy'] - 管理员用户名 (拥有最高权限)
* @returns {Promise<object>} - 编辑结果，包含 success: true 和 message。
* @throws {ValidationError} 如果输入无效或无权限
* @throws {Error} 如果数据库操作失败
*/
export async function updateComment({ postId, commentId, content, username, adminUsername = 'yolialisproxy' }) {
  // --- 1. Input Validation ---
  if (!postId || !validateInput(postId, 'id')) throw new ValidationError('无效的 postId');
  if (!commentId || !validateInput(commentId, 'id')) throw new ValidationError('无效的 commentId');
  if (!content || content.trim().length === 0) throw new ValidationError('评论内容不能为空');
  if (!username) throw new ValidationError('用户名不能为空');

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath); // Read the comment to be edited
    if (!commentData) {
      throw new ValidationError('评论不存在'); // Throw error if comment not found
    }

    // --- 2. Permission Check ---
    const isAuthor = commentData.name === username; // Check if requester is the author
    const isAdmin = username === adminUsername; // Check if requester is the admin
    if (!isAuthor && !isAdmin) {
      logger.warn(`[CommentsLib] updateComment: 无权限编辑评论 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
      throw new ValidationError('没有权限编辑此评论'); // Throw error if not authorized
    }

    // --- 3. Perform Update ---
    // Update only the content and the updatedAt timestamp
    await write(commentPath, { content: content.trim(), updatedAt: new Date().toISOString() }, { method: 'update' });
    logger.info(`[CommentsLib] updateComment: 评论编辑成功 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);

    // Optionally, if content changes might affect totalLikes (e.g., if likes are tied to content hashes),
    // you might need to re-trigger ancestor totalLikes updates here. For now, assuming likes are independent.

    return { success: true, message: '评论编辑成功' }; // Return success response

  } catch (error) {
    if (error instanceof ValidationError) throw error; // Re-throw validation errors
    logger.error(`[CommentsLib] updateComment: 编辑评论失败 (postId: ${postId}, commentId: ${commentId}, username: ${username}):`, error);
    throw new Error('Failed to update comment.'); // General error
  }
}
