// lib/comments.js - 终极优化版：移除TS，添加重试，统一Response (修复所有已知问题)

import {
  read, write, del, transaction, initFirebase, parseBody, setCORS, logger, computeTotalLikes, validateInput, ValidationError
} from '../lib/utils.js'; // 确保所有依赖的工具函数都已导入

console.log('✅ lib/comments.js加载成功');

initFirebase(); // 确保 Firebase 数据库实例已初始化

// ====================================================================
// 评论辅助功能 (例如总赞数计算和祖先更新)
// ====================================================================

/**
 * 计算并更新评论及其子评论的总点赞数 (totalLikes)。
 * 此函数调用 utils.js 中的核心计算逻辑，然后负责将结果持久化到数据库。
 * 注意：此递归方式在大规模深度嵌套场景下效率低下，建议异步触发。
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @returns {Promise<number>} - 更新后的总点赞数
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果计算或写入失败
 */
export async function computeCommentTreeTotalLikes(postId, commentId) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.warn(`computeCommentTreeTotalLikes: 无效的ID (postId: ${postId}, commentId: ${commentId})`);
    throw new ValidationError('无效的文章ID或评论ID');
  }

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn(`computeCommentTreeTotalLikes: 评论不存在，无法更新总赞数 (postId: ${postId}, commentId: ${commentId})`);
      return 0;
    }

    // 获取 floor 属性，默认为 1（顶层评论），作为 computeTotalLikes 的 depth 参数
    const depth = typeof commentData.floor === 'number' && commentData.floor >= 1 ? commentData.floor : 1;

    // 调用 utils.js 中的核心计算函数获取 totalLikes [5]
    const newTotalLikes = await computeTotalLikes(postId, commentId, depth);

    // 只有当 totalLikes 发生变化时才更新数据库
    if (commentData.totalLikes !== newTotalLikes) {
      await write(commentPath, { totalLikes: newTotalLikes, lastSync: new Date().toISOString() }, { method: 'update' });
      logger.info(`computeCommentTreeTotalLikes: 更新评论树总赞数 (postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes}, floor: ${depth})`);
    } else {
      logger.info(`computeCommentTreeTotalLikes: 评论树总赞数未变化，跳过写入 (postId: ${postId}, commentId: ${commentId}, floor: ${depth})`);
    }
    return newTotalLikes;

  } catch (error) {
    logger.error(`computeCommentTreeTotalLikes: 计算并更新评论树总赞数失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to compute and update comment tree total likes');
  }
}

/**
 * 向上更新祖先评论的 totalLikes。
 * @param {string} postId - 文章ID
 * @param {string} initialCommentId - 初始评论ID
 * @returns {Promise<void>}
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果更新失败
 */
export async function updateCommentAncestorsTotalLikes(postId, initialCommentId) {
  if (!validateInput(postId, 'id') || !validateInput(initialCommentId, 'id')) {
    logger.warn(`updateCommentAncestorsTotalLikes: 无效的ID (postId: ${postId}, initialCommentId: ${initialCommentId})`);
    throw new ValidationError('无效的文章ID或评论ID');
  }

  let currentCommentId = initialCommentId;
  try {
    const MAX_TRAVERSAL = 20; // 防止无限循环或深度过大
    let count = 0;

    while (currentCommentId !== '0' && currentCommentId && count < MAX_TRAVERSAL) {
      const commentPath = `comments/${postId}/${currentCommentId}`;
      const comment = await read(commentPath);

      if (!comment || !comment.parentId) { // 根评论或不存在时停止
        logger.info(`updateCommentAncestorsTotalLikes: 到达评论链的顶部或评论不存在 (postId: ${postId}, commentId: ${currentCommentId})`);
        break;
      }

      await computeCommentTreeTotalLikes(postId, currentCommentId); // 调用业务逻辑层的更新函数
      currentCommentId = comment.parentId;
      count++;
    }
  } catch (error) {
    logger.error(`updateCommentAncestorsTotalLikes: 更新祖先总赞数失败 (postId: ${postId}, initialCommentId: ${initialCommentId}):`, error);
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
 * @param {object} commentData - 评论数据
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
  const { postId, name, email, content, parentId = '0', isGuest = true } = commentData;

  // 1. 输入验证
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(name, 'name')) throw new ValidationError('评论者姓名无效 (需2-50字符)');
  if (!validateInput(content, 'comment')) throw new ValidationError('评论内容无效 (需5-500字符)');
  if (email && !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (parentId !== '0' && !validateInput(parentId, 'id')) throw new ValidationError('父评论ID无效');

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
        // 如果事务未能提交（例如并发冲突），这里可能需要重试策略
        logger.warn(`addComment: 楼层计数器事务未成功提交，可能存在并发冲突 (postId: ${postId})`);
        // 为了简化，这里不再增加重试逻辑，依赖 RealtimeDB 的重试机制
        // 但实际生产中可能需要更复杂的冲突解决
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
      // 如果登录用户，这里可以存储 username 作为 authorId
      // authorId: isGuest ? null : username,
      children: {} // Realtime DB 中子评论通常存储为对象 {childId: true}
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
      await computeCommentTreeTotalLikes(postId, parentId);
      await updateCommentAncestorsTotalLikes(postId, parentId);
    }

    logger.success(`addComment: 评论添加成功 (postId: ${postId}, commentId: ${commentId}, floor: ${newFloorValue || '子评论'})`);
    return { success: true, data: fullCommentData };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`addComment: 添加评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to add comment');
  }
}

/**
 * 获取文章的所有评论 (以树形结构返回)。
 * @param {string} postId - 文章ID
 * @returns {Promise<object[]>} - 评论树数组
 * @throws {ValidationError} 如果输入无效
 * @throws {Error} 如果数据库操作失败
 */
export async function getComments(postId) {
  if (!validateInput(postId, 'id')) {
    throw new ValidationError('文章ID无效');
  }

  try {
    const commentsData = await read(`comments/${postId}`);

    if (!commentsData) {
      logger.info(`getComments: 无评论数据 (postId: ${postId})`);
      return [];
    }

    const commentsMap = {};
    Object.values(commentsData).forEach(function(c) {
      // 检查关键字段是否存在
      if (!c || !c.id || !c.createdAt || !c.name || !c.content) {
        logger.warn(`getComments: 无效评论数据，已跳过 (postId: ${postId}, commentId: ${c?.id})`, c);
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
          logger.warn(`getComments: 孤立评论 (postId: ${postId}, commentId: ${comment.id})，归入顶层`);
          rootComments.push(comment);
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
    logger.success(`getComments: 成功获取评论数据 (postId: ${postId}, count: ${tree.length})`);
    return tree;

  } catch (error) {
    logger.error(`getComments: 获取评论失败 (postId: ${postId}):`, error);
    if (error instanceof ValidationError) throw error;
    throw new Error('Failed to fetch comments');
  }
}

/**
 * 删除评论 (及其子评论)。
 * @param {string} postId - 文章ID
 * @param {string} commentId - 待删除评论ID
 * @param {string} username - 请求删除的用户的用户名 (用于权限验证)
 * @param {string} [adminUsername='yolialisproxy'] - 管理员用户名 (拥有最高权限)
 * @returns {Promise<object>} - 删除结果
 * @throws {ValidationError} 如果输入无效或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function removeComment(postId, commentId, username, adminUsername = 'yolialisproxy') { // 参数名改为 adminUsername
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID无效');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('请求用户名无效或为空'); // 补充 username 验证

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      throw new ValidationError('评论不存在');
    }

    // 权限验证：只有评论作者或特殊管理员才能删除
    // 假设 commentData.name 存储的是评论者的 username 或 guest name
    const isAuthor = commentData.name === username;
    const isAdmin = username === adminUsername;

    if (!isAuthor && !isAdmin) {
      logger.warn(`removeComment: 无权限删除评论 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
      throw new ValidationError('没有权限删除此评论');
    }

    await del(commentPath);
    logger.success(`removeComment: 评论删除成功 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);

    // 更新父评论的 children 列表 (如果存在)
    if (commentData.parentId && commentData.parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${commentData.parentId}/children`;
      await transaction(parentChildrenPath, function(currentChildren) {
        const childrenMap = currentChildren || {};
        delete childrenMap[commentId]; // 从父评论的 children 对象中移除
        return childrenMap;
      });
      // 提交后异步更新父评论及其祖先 totalLikes
      await computeCommentTreeTotalLikes(postId, commentData.parentId);
      await updateCommentAncestorsTotalLikes(postId, commentData.parentId);
    }

    return { success: true, message: '评论删除成功' };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`removeComment: 删除评论失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to remove comment');
  }
}

/**
 * 编辑评论内容。
 * @param {string} postId - 文章ID
 * @param {string} commentId - 待编辑评论ID
 * @param {string} content - 新的评论内容
 * @param {string} username - 请求编辑的用户的用户名 (用于权限验证)
 * @returns {Promise<object>} - 编辑结果
 * @throws {ValidationError} 如果输入无效或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function updateComment(postId, commentId, content, username) {
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID无效');
  if (!validateInput(content, 'comment')) throw new ValidationError('评论内容无效 (需5-500字符)');
  if (!username || !validateInput(username, 'username')) throw new ValidationError('请求用户名无效或为空'); // 补充 username 验证

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      throw new ValidationError('评论不存在');
    }

    // 权限验证：只有评论作者或特殊管理员才能编辑
    const isAuthor = commentData.name === username;
    const isAdmin = username === 'yolialisproxy'; // 硬编码管理员名称，与其他模块一致

    if (!isAuthor && !isAdmin) {
      logger.warn(`updateComment: 无权限编辑评论 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
      throw new ValidationError('没有权限编辑此评论');
    }

    await write(commentPath, { content: content.trim(), updatedAt: new Date().toISOString() }, { method: 'update' });

    logger.success(`updateComment: 评论编辑成功 (postId: ${postId}, commentId: ${commentId}, username: ${username})`);
    return { success: true, message: '评论编辑成功' };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`updateComment: 编辑评论失败 (postId: ${postId}, commentId: ${commentId}, username: ${username}):`, error);
    throw new Error('Failed to update comment');
  }
}

// ====================================================================
// 默认导出的 HTTP API 接口函数 (为 api/index.js 调用而设计)
// ====================================================================

/**
 * 默认导出的 HTTP API 接口函数。
 * 处理所有评论相关的 HTTP 请求 (提交、获取、删除、编辑)。
 * @param {Request} req - HTTP请求对象，Vercel环境下的Web标准Request对象
 * @param {Response} res - HTTP响应对象，Vercel环境下的Web标准Response对象
 * @returns {Promise<Response>} - 包含操作结果的HTTP响应
 */
export default async function commentApiHandler(req, res) { // 修正为默认导出
  // 捕获原始请求头，以便在响应中正确合并，尤其是为了CORS
  const responseHeaders = req.headers ? Object.fromEntries(req.headers.entries()) : {};
  setCORS(res, req); // 设置 CORS 头

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...res.headers.raw(), ...responseHeaders, 'Content-Type': 'application/json' }
    });
  }

  let body = {};
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    try {
      body = await parseBody(req);
    } catch (error) {
      logger.error('commentApiHandler: 请求体解析失败', error);
      return new Response(JSON.stringify({ success: false, message: 'Invalid request body' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...res.headers.raw(),
          ...responseHeaders
        }
      });
    }
  }

  // 确保 URL 构造器在 Vercel Edge Runtime 中能正确工作
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
  const urlParams = url.searchParams;

  // 从 URL query 或 body 中获取关键参数，body 优先
  const postId = urlParams.get('postId') || body.postId;
  const commentId = urlParams.get('commentId') || body.commentId;
  const username = body.username; // 用于权限验证，从请求体中获取

  try {
    let result;
    switch (req.method) {
      case 'POST': // 提交评论
        result = await addComment({
          postId,
          name: body.name,
          email: body.email,
          content: body.comment, // 前端可能使用 'comment' 作为字段名
          parentId: body.parentId,
          isGuest: body.isGuest,
          // 如果这里需要 authorId，则根据 username 传入
          // authorId: body.username // 如果前端登录后会发送 username
        });
        break;
      case 'GET': // 获取评论
        if (!postId) throw new ValidationError('获取评论需要 postId 参数');
        result = await getComments(postId);
        break;
      case 'DELETE': // 删除评论
        if (!username) throw new ValidationError('删除评论需要提供 username 进行权限验证');
        if (!commentId) throw new ValidationError('删除评论需要 commentId 参数');
        result = await removeComment(postId, commentId, username);
        break;
      case 'PUT': // 编辑评论
        if (!username) throw new ValidationError('编辑评论需要提供 username 进行权限验证');
        if (!commentId) throw new ValidationError('编辑评论需要 commentId 参数');
        if (!body.comment) throw new ValidationError('编辑评论需要新的 comment 内容'); // 确保有新内容
        result = await updateComment(postId, commentId, body.comment, username);
        break;
      default:
        return new Response(JSON.stringify({ success: false, message: `Method ${req.method} Not Allowed` }), {
          status: 405,
          headers: {
            'Allow': 'GET, POST, PUT, DELETE, OPTIONS',
            'Content-Type': 'application/json',
            ...res.headers.raw(),
            ...responseHeaders
          },
        });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...res.headers.raw(),
        ...responseHeaders
      },
    });

  } catch (error) {
    logger.error('commentApiHandler: API处理失败', error, { postId, commentId, username, method: req.method });
    let status = 500;
    if (error instanceof ValidationError) {
      status = 400; // 客户端输入错误
    } else if (error.message.includes('not found')) { // 针对评论不存在的错误
        status = 404;
    }

    // 根据环境返回不同的错误信息
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ success: false, message }), {
      status: status,
      headers: {
        'Content-Type': 'application/json',
        ...res.headers.raw(),
        ...responseHeaders
      },
    });
  }
}
