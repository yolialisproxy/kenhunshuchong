// lib/comments.js - 评论业务逻辑模块，并提供一个默认导出的HTTP接口

// 从 utils.js 导入底层数据库操作、HTTP 辅助函数、以及核心的计算和验证工具
import {
  read, write, del, transaction, initFirebase,
  parseBody, setCORS,
  computeTotalLikes, validateInput, // 新增导入 computeTotalLikes 和 validateInput
} from './utils.js';

console.log('✅ lib/comments.js加载成功');

initFirebase(); // 确保 Firebase 数据库实例已初始化

/**
 * 结构化日志记录器
 */
const logger = {
  info: (message, context = {}) => console.log(`ℹ️ [CommentsService] ${message}`, context),
  warn: (message, context = {}) => console.warn(`⚠️ [CommentsService] ${message}`, context),
  error: (message, error, context = {}) => console.error(`❌ [CommentsService] ${message}`, context, error ? error.stack : ''),
  success: (message, context = {}) => console.log(`✅ [CommentsService] ${message}`, context),
};

/**
 * 自定义验证错误类
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ====================================================================
// 评论辅助功能 (例如总赞数计算) - 调用 utils 中的核心计算函数
// ====================================================================

/**
 * [性能警告] 计算并更新评论及其子评论的总点赞数 (totalLikes)。
 * 此函数调用 utils.js 中的核心计算逻辑，然后负责将结果持久化到数据库。
 * 注意：此递归方式在大规模深度嵌套场景下效率低下。
 * 强烈建议使用 Firebase Cloud Functions 触发器进行异步汇总。
 * @param {string} postId - 文章ID
 * @param {string} commentId - 评论ID
 * @param {number} [depth=0] - 当前递归深度限制
 * @returns {Promise<number>} - 更新后的总点赞数
 * @throws {Error} 如果计算或写入失败
 */
async function computeCommentTreeTotalLikes(postId, commentId) { // 移除 depth 参数，由 utils.computeTotalLikes 内部处理
  // 1. 输入验证
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('无效的文章ID或评论ID');
  }

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    // 调用 utils 中的核心计算函数获取 totalLikes
    const newTotalLikes = await computeTotalLikes(postId, commentId);

    const commentData = await read(commentPath); // 再次读取，确保拿到最新 totalLikes 状态
    if (!commentData) {
      logger.warn(`评论不存在，无法更新总赞数 ( postId: ${postId}, commentId: ${commentId} )`);
      return newTotalLikes; // 计算出了结果，但评论不存在，返回计算结果
    }

    // 2. 将计算结果持久化到数据库
    if (commentData.totalLikes !== newTotalLikes) {
      await write(commentPath, { totalLikes: newTotalLikes, lastSync: new Date().toISOString() }, { method: 'update' });
      logger.info(`更新评论树总赞数 ( postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes} )`);
    } else {
      logger.info(`评论树总赞数未变化，跳过写入 ( postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes} )`);
    }
    return newTotalLikes;

  } catch (error) {
    logger.error(`计算并更新评论树总赞数失败 ( postId: ${postId}, commentId: ${commentId} ):`, error);
    throw new Error('Failed to compute and update comment tree total likes');
  }
}

/**
 * [性能警告] 向上更新祖先评论的 totalLikes。
 * 同上，在高并发或深度嵌套评论中应谨慎使用。
 * @param {string} postId - 文章ID
 * @param {string} initialCommentId - 初始评论ID
 * @returns {Promise<void>}
 * @throws {Error} 如果更新失败
 */
async function updateCommentAncestorsTotalLikes(postId, initialCommentId) { // 移除 depth 参数
  // 1. 输入验证
  if (!validateInput(postId, 'id') || !validateInput(initialCommentId, 'id')) {
    throw new ValidationError('无效的文章ID或评论ID');
  }

  let currentCommentId = initialCommentId;
  try {
    const MAX_ANCESTOR_TRAVERSAL = 50; // 防止无限循环
    let traversalCount = 0;

    while (currentCommentId !== '0' && currentCommentId !== undefined && currentCommentId !== null && traversalCount < MAX_ANCESTOR_TRAVERSAL) {
      const commentPath = `comments/${postId}/${currentCommentId}`;
      const comment = await read(commentPath);

      if (!comment || !comment.parentId) { // 根评论或不存在时停止
        logger.info(`到达评论链的顶部或评论不存在 ( postId: ${postId}, commentId: ${currentCommentId} )`);
        break;
      }

      await computeCommentTreeTotalLikes(postId, currentCommentId); // 调用上面业务逻辑层的更新函数
      currentCommentId = comment.parentId;
      traversalCount++;
    }
  } catch (error) {
    logger.error(`更新祖先总赞数失败 ( postId: ${postId}, initialCommentId: ${initialCommentId} ):`, error);
    throw new Error('Failed to update ancestor total likes');
  }
}

// ====================================================================
// 核心评论操作功能 (业务逻辑层)
// ====================================================================

/**
 * 提交新评论
 * @param {object} commentData - 评论数据
 * @param {string} commentData.postId - 文章ID
 * @param {string} commentData.name - 评论者姓名
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

  // 1. 输入验证 (使用 utils.validateInput)
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(name, 'name')) throw new ValidationError('评论者姓名无效 (需2-50字符)');
  if (!validateInput(content, 'comment')) throw new ValidationError('评论内容无效 (需5-500字符)');
  if (email && !validateInput(email, 'email')) throw new ValidationError('邮箱格式不正确');
  if (parentId !== '0' && !validateInput(parentId, 'id')) throw new ValidationError('父评论ID无效');


  const commentsPath = `comments/${postId}`;

  try {
    // 2. 检查父评论是否存在 (如果不是顶层评论)
    if (parentId !== '0') {
      const parentComment = await read(`${commentsPath}/${parentId}`);
      if (!parentComment) {
        throw new ValidationError('父评论不存在');
      }
    }

    // 3. 使用 write 函数，method: 'push' 创建新评论并获取 key
    const newCommentRef = await write(commentsPath, {}, { method: 'push' });
    const commentId = newCommentRef.key; // write 函数的 push 方法现在返回 { key: string }

    const fullCommentData = {
      id: commentId,
      name: name.trim(),
      email: email ? email.trim() : null,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0,
      totalLikes: 0,
      parentId: parentId,
      isGuest,
      children: {} // Realtime DB 中子评论通常存储为对象 {childId: true}
    };

    await write(`${commentsPath}/${commentId}`, fullCommentData, { method: 'set' });

    // 4. 如果是子评论，更新父评论的 children 列表
    if (parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${parentId}/children`;
      await transaction(parentChildrenPath, (currentChildren) => {
        const childrenMap = currentChildren || {};
        childrenMap[commentId] = true;
        return childrenMap;
      });
      // 提交后异步更新父评论及其祖先 totalLikes
      await computeCommentTreeTotalLikes(postId, parentId);
      await updateCommentAncestorsTotalLikes(postId, parentId);
    }

    logger.success(`评论提交成功 (postId: ${postId}, commentId: ${commentId}, parentId: ${parentId})`);
    return { success: true, data: fullCommentData };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`提交评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to add comment');
  }
}

/**
 * 获取文章的所有评论 (以树形结构返回)
 * @param {string} postId - 文章ID
 * @returns {Promise<Object[]>} - 评论树数组
 * @throws {ValidationError} 如果输入验证失败
 * @throws {Error} 如果数据库操作失败
 */
export async function fetchComments(postId) {
  // 1. 输入验证
  if (!validateInput(postId, 'id')) {
    throw new ValidationError('文章ID无效');
  }

  try {
    const commentsData = await read(`comments/${postId}`);

    if (!commentsData) {
      logger.info(`无评论数据 (postId: ${postId})`);
      return [];
    }

    const commentsMap = {}; // 移除 TypeScript 类型注解
    Object.values(commentsData).forEach((c) => { // 移除 TypeScript 类型注解
      // 检查关键字段是否存在 (c 已经不是 any 了)
      if (!c || !c.id || !c.createdAt || !c.name || !c.content) {
        logger.warn(`无效评论数据，已跳过 (postId: ${postId}, commentId: ${c?.id})`, c);
        return;
      }
      c.children = c.children && typeof c.children === 'object' ? c.children : {};
      c.likes = c.likes || 0;
      c.totalLikes = c.totalLikes || 0;
      c.parentId = c.parentId || '0';
      commentsMap[c.id] = c;
    });

    const rootComments = []; // 移除 TypeScript 类型注解
    Object.values(commentsMap).forEach((comment) => { // 移除 TypeScript 类型注解
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
          logger.warn(`孤立评论 (postId: ${postId}, commentId: ${comment.id})，归入顶层`, { comment });
          rootComments.push(comment);
        }
      }
    });

    // 递归函数，将 children 对象转换为数组并进行排序
    function buildCommentTree(comments) { // 移除 TypeScript 类型注解
      comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      comments.forEach(c => {
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
    logger.success(`成功获取评论数据 (postId: ${postId})`, { count: tree.length });
    return tree;

  } catch (error) {
    logger.error(`获取评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to fetch comments');
  }
}

/**
 * 删除评论 (及其子评论)
 * @param {string} postId - 文章ID
 * @param {string} commentId - 待删除评论ID
 * @param {string} requestingUserId - 请求删除的用户的ID (用于权限验证)
 * @param {string} [adminId='yolialisproxy'] - 管理员ID (拥有最高权限)
 * @returns {Promise<object>} - 删除结果
 * @throws {ValidationError} 如果输入验证失败或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function removeComment(postId, commentId, requestingUserId, adminId = 'yolialisproxy') {
  // 1. 输入验证
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID无效');
  if (!requestingUserId) throw new ValidationError('请求用户ID不能为空'); // requestingUserId 可不验证格式，因为它可能不是标准ID

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      throw new ValidationError('评论不存在');
    }

    // 权限验证：只有评论作者或特殊管理员才能删除
    const isAuthor = commentData.name === requestingUserId;
    const isProxyAdmin = (requestingUserId === adminId);

    if (!isAuthor && !isProxyAdmin) {
      throw new ValidationError('没有权限删除此评论');
    }

    // 执行删除操作
    await del(commentPath);
    logger.success(`评论删除成功 (postId: ${postId}, commentId: ${commentId}, requestingUser: ${requestingUserId})`);

    // 更新父评论的 children 列表 (如果存在)
    if (commentData.parentId && commentData.parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${commentData.parentId}/children`;
      await transaction(parentChildrenPath, (currentChildren) => {
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
    logger.error(`删除评论失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to remove comment');
  }
}

/**
 * 编辑评论内容
 * @param {string} postId - 文章ID
 * @param {string} commentId - 待编辑评论ID
 * @param {string} content - 新的评论内容
 * @param {string} requestingUserId - 请求编辑的用户的ID (用于权限验证)
 * @returns {Promise<object>} - 编辑结果
 * @throws {ValidationError} 如果输入验证失败或无权限
 * @throws {Error} 如果数据库操作失败
 */
export async function updateComment(postId, commentId, content, requestingUserId) {
  // 1. 输入验证
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID无效');
  if (!validateInput(content, 'comment')) throw new ValidationError('评论内容无效 (需5-500字符)');
  if (!requestingUserId) throw new ValidationError('请求用户ID不能为空');

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) {
      throw new ValidationError('评论不存在');
    }

    // 权限验证：只有评论作者或特殊管理员才能编辑
    const isAuthor = commentData.name === requestingUserId;
    const isProxyAdmin = (requestingUserId === 'yolialisproxy');

    if (!isAuthor && !isProxyAdmin) {
      throw new ValidationError('没有权限编辑此评论');
    }

    // 执行更新操作
    await write(commentPath, { content: content.trim(), updatedAt: new Date().toISOString() }, { method: 'update' });

    logger.success(`评论编辑成功 (postId: ${postId}, commentId: ${commentId}, requestingUser: ${requestingUserId})`);
    return { success: true, message: '评论编辑成功' };

  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error(`编辑评论失败 (postId: ${postId}, commentId: ${commentId}, requestingUser: ${requestingUserId}):`, error);
    throw new Error('Failed to update comment');
  }
}

// ====================================================================
// 默认导出的 HTTP API 接口函数
// ====================================================================

/**
 * 默认导出的 HTTP API 接口函数。
 * 处理所有评论相关的 HTTP 请求 (提交、获取、删除、编辑)。
 * @param {Request} req - HTTP请求对象
 * @param {Response} res - HTTP响应对象
 * @returns {Promise<Response>} - 包含操作结果的HTTP响应
 */
export default async function commentApiHandler(req, res) { // 移除 TypeScript 类型注解
  // 设置 CORS 头，处理预检请求
  setCORS(res, req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: res.headers });
  }

  let body = {}; // 移除 TypeScript 类型注解
  // 使用 req.url 而不是 req.url || ''，因为 Request 对象总有 url 属性
  let urlParams = new URL(req.url).searchParams; // 移除 TypeScript 类型注解


  // POST, PUT, DELETE 请求通常有请求体
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    try {
      body = await parseBody(req);
    } catch (parseError) { // 移除 TypeScript 类型注解
      logger.error('请求体解析失败', parseError);
      return new Response(JSON.stringify({ success: false, message: 'Invalid request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...res.headers.raw() }, // 适配 Response.headers.raw()
      });
    }
  }

  // 从 URL query 或 body 中获取关键参数
  const postId = urlParams.get('postId') || body.postId;
  const commentId = urlParams.get('commentId') || body.commentId;
  const requestingUserId = body.userId; // 假设 userId 从请求体中来，用于权限验证

  try {
    let result; // 移除 TypeScript 类型注解
    switch (req.method) {
      case 'POST': // 提交评论
        result = await addComment({
          postId,
          name: body.name,
          email: body.email,
          content: body.comment,
          parentId: body.parentId,
          isGuest: body.isGuest,
        });
        break;
      case 'GET': // 获取评论
        result = await fetchComments(postId);
        break;
      case 'DELETE': // 删除评论
        if (!requestingUserId) throw new ValidationError('删除评论需要提供 userId 进行权限验证');
        result = await removeComment(postId, commentId, requestingUserId);
        break;
      case 'PUT': // 编辑评论
        if (!requestingUserId) throw new ValidationError('编辑评论需要提供 userId 进行权限验证');
        result = await updateComment(postId, commentId, body.comment, requestingUserId);
        break;
      default:
        return new Response(JSON.stringify({ success: false, message: `Method ${req.method} Not Allowed` }), {
          status: 405,
          headers: { 'Allow': 'GET, POST, PUT, DELETE, OPTIONS', 'Content-Type': 'application/json', ...res.headers.raw() },
        });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...res.headers.raw()},
    });

  } catch (error) { // 移除 TypeScript 类型注解
    logger.error('评论API处理失败', error, { postId, commentId, requestingUserId, method: req.method });
    const status = error.name === 'ValidationError' ? 400 : 500;
    return new Response(JSON.stringify({ success: false, message: error.message || 'Internal server error' }), {
      status: status,
      headers: { 'Content-Type': 'application/json', ...res.headers.raw()},
    });
  }
}

// 导出所有功能函数 (包括默认导出的API接口和所有的业务逻辑函数)
export {
  addComment,
  fetchComments,
  removeComment,
  updateComment,
  computeCommentTreeTotalLikes,
  updateCommentAncestorsTotalLikes,
  ValidationError
};
