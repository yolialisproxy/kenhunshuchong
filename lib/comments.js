// lib/comments.js - 终极优化版：移除TS，添加重试，统一Response (修复所有已知问题)

import {
  read, write, del, transaction, initFirebase, logger, computeTotalLikes, validateInput, ValidationError
  // 移除对 parseBody, setCORS 的导入，因为它们只用于 commentApiHandler (已移除)
} from '../lib/utils.js'; // 确保所有依赖的工具函数都已导入

logger.info('✅ lib/comments.js加载成功'); // 使用 logger.info 保持一致

initFirebase(); // 确保 Firebase 数据库实例已初始化

// ====================================================================
// 评论辅助功能 (例如总赞数计算和祖先更新)
// ====================================================================

/**
 * 计算并更新评论及其子评论的总点赞数 (totalLikes)。
 * 此函数调用 utils.js 中的核心计算逻辑，然后负责将结果持久化到数据库。
 * 注意：此递归方式在大规模深度嵌套场景下效率低下，建议异步触发。
 * @param {object} data - 包含 postId 和 commentId 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 评论ID
 * @returns {Promise<number>} - 更新后的总点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果计算或写入失败
 */
export async function computeCommentTreeTotalLikes({ postId, commentId }) {

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn(`[CommentsLib] computeCommentTreeTotalLikes: 评论不存在，无法更新总赞数 (postId: ${postId}, commentId: ${commentId})`);
      return 0;
    }

    // 获取 floor 属性，默认为 1（顶层评论），作为 computeTotalLikes 的 depth 参数
    const depth = typeof commentData.floor === 'number' && commentData.floor >= 1 ? commentData.floor : 1;

    // 调用 utils.js 中的核心计算函数获取 totalLikes [4]
    const newTotalLikes = await computeTotalLikes(postId, commentId, depth);

    // 只有当 totalLikes 发生变化时才更新数据库
    if (commentData.totalLikes !== newTotalLikes) {
      await write(commentPath, { totalLikes: newTotalLikes, lastSync: new Date().toISOString() }, { method: 'update' });
      logger.info(`[CommentsLib] computeCommentTreeTotalLikes: 更新评论树总赞数 (postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes}, floor: ${depth})`);
    } else {
      logger.info(`[CommentsLib] computeCommentTreeTotalLikes: 评论树总赞数未变化，跳过写入 (postId: ${postId}, commentId: ${commentId}, floor: ${depth})`);
    }
    return newTotalLikes;

  } catch (error) {
    logger.error(`[CommentsLib] computeCommentTreeTotalLikes: 计算并更新评论树总赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to compute and update comment tree total likes');
  }
}

/**
 * 向上更新祖先评论的 totalLikes。
 * @param {object} data - 包含 postId 和 initialCommentId 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.initialCommentId - 初始评论ID
 * @returns {Promise<void>}
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果更新失败
 */
export async function updateCommentAncestorsTotalLikes({ postId, initialCommentId }) {

  let currentCommentId = initialCommentId;
  try {
    const MAX_TRAVERSAL = 20; // 防止无限循环或深度过大
    let count = 0;

    while (currentCommentId !== '0' && currentCommentId && count < MAX_TRAVERSAL) {
      const commentPath = `comments/${postId}/${currentCommentId}`;
      const comment = await read(commentPath);

      if (!comment || !comment.parentId) { // 根评论或不存在时停止
        logger.info(`[CommentsLib] updateCommentAncestorsTotalLikes: 到达评论链的顶部或评论不存在 (postId: ${postId}, commentId: ${currentCommentId})`);
        break;
      }

      // 修正内部调用为对象模式
      await computeCommentTreeTotalLikes({ postId, commentId: currentCommentId }); // 调用业务逻辑层的更新函数
      currentCommentId = comment.parentId;
      count++;
    }
  } catch (error) {
    logger.error(`[CommentsLib] updateCommentAncestorsTotalLikes: 更新祖先总赞数失败 (postId: ${postId}, initialCommentId: ${initialCommentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to update ancestor total likes');
  }
}

// ====================================================================
// 核心评论操作功能
// ====================================================================

/**
 * 提交新评论 (新增楼层 (floor) 功能)。
 * 顶层评论 (parentId='0') 会获得递增的楼层号，子评论则为 null。
 * @param {object} commentData - 评论数据对象
 * @param {string} commentData.postId - 文章ID
 * @param {string} commentData.name - 评论者姓名 (如果是登录用户，此处应为 username)
 * @param {string} commentData.email - 评论者邮箱
 * @param {string} commentData.content - 评论内容
 * @param {string} [commentData.parentId='0'] - 父评论ID，'0'表示顶层评论
 * @param {boolean} [commentData.isGuest=true] - 是否为匿名评论
 * @returns {Promise<object>} - 提交成功的评论数据
 * @throws {ValidationError} 如果输入验证失败
 * @throws {Error} 如果数据库操作失败
 */
export async function addComment(commentData) {
  const { postId, name, email, content, parentId = '0', isGuest = true } = commentData; // 保持解构作为内部处理

  // 1. 输入验证
  if (!validateInput(name, 'name')) throw new ValidationError('评论者姓名无效 (需2-50字符)');
  if (email && !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');

  const commentsPath = `comments/${postId}`;
  const metadataPath = `comments/${postId}/metadata/floorCounter`; // 用于存储顶层评论的楼层计数器

  try {
    // 2. 检查父评论是否存在 (如果不是顶层评论)
    if (parentId !== '0') {
      const parentComment = await read(`${commentsPath}/${parentId}`);
      if (!parentComment) {
        throw new ValidationError('父评论不存在');
      }
    }

    // 3. 为新评论生成ID
    const newRef = await write(commentsPath, null, { method: 'push' }); // write 函数的 push 方法现在返回 { key: string }
    const commentId = newRef.key;

    let newFloorValue = null; // 默认为子评论
    if (parentId === '0') {
      // 4. 如果是顶层评论，原子性地获取并分配楼层号
      const transactionResult = await transaction(metadataPath, function(current) {
        const currentCounter = current?.counter || 0;
        newFloorValue = currentCounter + 1; // 当前评论的楼层号
        return { counter: newFloorValue }; // 更新计数器为下一个评论的值
      });

      if (!transactionResult.committed) {
        logger.warn(`[CommentsLib] addComment: 楼层计数器事务未成功提交，可能存在并发冲突 (postId: ${postId})`);
      }
    }

    // 5. 构建完整的评论数据
    const fullCommentData = {
      id: commentId,
      name: name.trim(),
      email: email ? email.trim() : null,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0,              // 直接点赞数
      totalLikes: 0,         // 包含子评论的总点赞数
      parentId: parentId,
      floor: newFloorValue,  // 楼层号 (顶层评论有，子评论为null)
      isGuest,
      children: {}
    };

    // 6. 写入新评论数据
    await write(`${commentsPath}/${commentId}`, fullCommentData, { method: 'set' });

    // 7. 如果是子评论，更新父评论的 children 列表
    if (parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${parentId}/children`;
      await transaction(parentChildrenPath, function(currentChildren) {
        const childrenMap = currentChildren || {};
        childrenMap[commentId] = true;
        return childrenMap;
      });
      // 提交后异步更新父评论及其祖先 totalLikes
      await computeCommentTreeTotalLikes({ postId, commentId: parentId }); // 修正内部调用
      await updateCommentAncestorsTotalLikes({ postId, initialCommentId: parentId }); // 修正内部调用
    }

    logger.info(`[CommentsLib] addComment: 评论添加成功 (postId: ${postId}, commentId: ${commentId}, floor: ${newFloorValue || '子评论'})`);
    return fullCommentData; // 返回完整的评论数据，不需要 success: true 包装，由 api/index.js 统一处理

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`[CommentsLib] addComment: 添加评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to add comment');
  }
}

/**
 * 获取文章的所有评论 (以树形结构返回)。
 * @param {object} data - 包含 postId 的对象
 * @param {string} data.postId - 文章ID
 * @returns {Promise<object[]>} - 评论树数组
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getComments({ postId }) {

  try {
    const commentsData = await read(`comments/${postId}`);

    if (!commentsData) {
      logger.info(`[CommentsLib] getComments: 无评论数据 (postId: ${postId})`);
      return [];
    }

    const commentsMap = {};
    Object.values(commentsData).forEach(function(c) {
      // 检查关键字段是否存在
      if (!c || !c.id || !c.createdAt || !c.name || !c.content) {
        logger.warn(`[CommentsLib] getComments: 无效评论数据，已跳过 (postId: ${postId}, commentId: ${c?.id})`, c);
        return;
      }
      c.children = c.children && typeof c.children === 'object' ? c.children : {};
      c.likes = typeof c.likes === 'number' ? c.likes : 0;
      c.totalLikes = typeof c.totalLikes === 'number' ? c.totalLikes : 0;
      c.parentId = c.parentId || '0';
      commentsMap[c.id] = c;
    });

    const rootComments = [];
    Object.values(commentsMap).forEach(function(comment) {
      if (comment.parentId === '0') {
        rootComments.push(comment);
      } else {
        const parent = commentsMap[comment.parentId];
        if (parent) {
          if (!parent._childrenArray) {
            parent._childrenArray = [];
          }
          parent._childrenArray.push(comment);
        } else {
          logger.warn(`[CommentsLib] getComments: 孤立评论 (postId: ${postId}, commentId: ${comment.id})，归入顶层`);
          rootComments.push(comment);
        }
      }
    });

    // 递归函数，将 children 对象转换为数组并进行排序
    function buildCommentTree(comments) {
      comments.sort(function(a, b) { return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); });
      comments.forEach(function(c) {
        if (c._childrenArray) {
          c.children = buildCommentTree(c._childrenArray);
          delete c._childrenArray;
        } else {
          c.children = [];
        }
      });
      return comments;
    }

    const tree = buildCommentTree(rootComments);
    logger.info(`[CommentsLib] getComments: 成功获取评论数据 (postId: ${postId}, count: ${tree.length})`);
    return tree;

  } catch (error) {
    logger.error(`[CommentsLib] getComments: 获取评论失败 (postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to fetch comments');
  }
}

/**
 * 删除评论 (及其子评论)。
 * @param {object} data - 包含 postId, commentId, username 和 adminUsername 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 待删除评论ID
 * @param {string} data.username - 请求删除的用户的用户名 (用于权限验证)
 * @param {string} [data.adminUsername='yolialisproxy'] - 管理员用户名 (拥有最高权限)
 * @returns {Promise<object>} - 删除结果
 * @throws {ValidationError} 如果输入无效或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function deleteComment({ postId, commentId, username, adminUsername = 'yolialisproxy' }) {

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      throw new ValidationError('评论不存在');
    }

    // 权限验证：只有评论作者或特殊管理员才能删除
    const isAuthor = commentData.name === username;
    const isAdmin = username === adminUsername;

    if (!isAuthor && !isAdmin) {
      logger.warn(`[CommentsLib] deleteComment: 无权限删除评论 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
      throw new ValidationError('没有权限删除此评论');
    }

    await del(commentPath);
    logger.info(`[CommentsLib] deleteComment: 评论删除成功 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);

    // 更新父评论的 children 列表 (如果存在)
    if (commentData.parentId && commentData.parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${commentData.parentId}/children`;
      await transaction(parentChildrenPath, function(currentChildren) {
        const childrenMap = currentChildren || {};
        delete childrenMap[commentId]; // 从父评论的 children 对象中移除
        return childrenMap;
      });
      // 提交后异步更新父评论及其祖先 totalLikes
      await computeCommentTreeTotalLikes({ postId, commentId: commentData.parentId }); // 修正内部调用
      await updateCommentAncestorsTotalLikes({ postId, initialCommentId: commentData.parentId }); // 修正内部调用
    }

    return { success: true, message: '评论删除成功' };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`[CommentsLib] deleteComment: 删除评论失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to remove comment');
  }
}

/**
 * 编辑评论内容。
 * @param {object} data - 包含 postId, commentId, content, username 的对象
 * @param {string} data.postId - 文章ID
 * @param {string} data.commentId - 待编辑评论ID
 * @param {string} data.content - 新的评论内容
 * @param {string} data.username - 请求编辑的用户的用户名 (用于权限验证)
 * @param {string} [data.adminUsername='yolialisproxy'] - 管理员用户名 (拥有最高权限)
 * @returns {Promise<object>} - 编辑结果
 * @throws {ValidationError} 如果输入无效或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function updateComment({ postId, commentId, content, username, adminUsername = 'yolialisproxy' }) {

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      throw new ValidationError('评论不存在');
    }

    // 权限验证：只有评论作者或特殊管理员才能编辑
    const isAuthor = commentData.name === username;
    const isAdmin = username === adminUsername; // 使用传入的 adminUsername

    if (!isAuthor && !isAdmin) {
      logger.warn(`[CommentsLib] updateComment: 无权限编辑评论 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
      throw new ValidationError('没有权限编辑此评论');
    }

    await write(commentPath, { content: content.trim(), updatedAt: new Date().toISOString() }, { method: 'update' });

    logger.info(`[CommentsLib] updateComment: 评论编辑成功 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
    return { success: true, message: '评论编辑成功' };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`[CommentsLib] updateComment: 编辑评论失败 (postId: ${postId}, commentId: ${commentId}, username: ${username}):`, error);
    throw new Error('Failed to update comment');
  }
}

// 移除了默认导出的 commentApiHandler 函数，因为 api/index.js 将直接调用上述业务逻辑函数。
// constrol comes from api/index.js (central dispatcher).
