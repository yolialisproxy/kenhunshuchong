// lib/comments.js - 优化版：移除TS，添加重试，统一Response

import {
  read, write, del, transaction, initFirebase,
  parseBody, setCORS,
  computeTotalLikes, validateInput
} from '../lib/utils.js';

console.log('✅ lib/comments.js加载成功');

initFirebase();

const logger = {
  info: function(message, context) { console.log(`ℹ️ [CommentsService] ${message}`, context || ''); },
  warn: function(message, context) { console.warn(`⚠️ [CommentsService] ${message}`, context || ''); },
  error: function(message, error, context) { console.error(`❌ [CommentsService] ${message}`, context || '', error ? error.stack : ''); },
  success: function(message, context) { console.log(`✅ [CommentsService] ${message}`, context || ''); },
};

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// 计算总赞数 (业务层调用utils)
export async function computeCommentTreeTotalLikes(postId, commentId) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    throw new ValidationError('无效的文章ID或评论ID');
  }

  const commentPath = `comments/${postId}/${commentId}`;
  try {
    const newTotalLikes = await computeTotalLikes(postId, commentId);

    const commentData = await read(commentPath);
    if (!commentData) {
      logger.warn(`评论不存在 ( postId: ${postId}, commentId: ${commentId} )`);
      return newTotalLikes;
    }

    if (commentData.totalLikes !== newTotalLikes) {
      await write(commentPath, { totalLikes: newTotalLikes, lastSync: new Date().toISOString() }, { method: 'update' });
      logger.info(`更新总赞数 ( postId: ${postId}, commentId: ${commentId}, totalLikes: ${newTotalLikes} )`);
    } else {
      logger.info(`总赞数未变化 ( postId: ${postId}, commentId: ${commentId} )`);
    }
    return newTotalLikes;

  } catch (error) {
    logger.error(`计算总赞数失败 ( postId: ${postId}, commentId: ${commentId} ):`, error);
    throw new Error('Failed to compute total likes');
  }
}

// 更新祖先总赞数
export async function updateCommentAncestorsTotalLikes(postId, initialCommentId) {
  if (!validateInput(postId, 'id') || !validateInput(initialCommentId, 'id')) {
    throw new ValidationError('无效的文章ID或评论ID');
  }

  let currentCommentId = initialCommentId;
  try {
    const MAX_TRAVERSAL = 20; // 优化深度
    let count = 0;

    while (currentCommentId !== '0' && currentCommentId && count < MAX_TRAVERSAL) {
      const commentPath = `comments/${postId}/${currentCommentId}`;
      const comment = await read(commentPath);

      if (!comment || !comment.parentId) {
        logger.info(`到达顶部 ( postId: ${postId}, commentId: ${currentCommentId} )`);
        break;
      }

      await computeCommentTreeTotalLikes(postId, currentCommentId);
      currentCommentId = comment.parentId;
      count++;
    }
  } catch (error) {
    logger.error(`更新祖先失败 ( postId: ${postId}, initialCommentId: ${initialCommentId} ):`, error);
    throw new Error('Failed to update ancestors');
  }
}

// 添加评论 (分步骤：验证->检查父级->写入->更新)
export async function addComment(commentData) {
  const { postId, name, email, content, parentId = '0', isGuest = true } = commentData;

  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(name, 'name')) throw new ValidationError('姓名无效');
  if (!validateInput(content, 'comment')) throw new ValidationError('内容无效');
  if (email && !validateInput(email, 'email')) throw new ValidationError('邮箱无效');
  if (parentId !== '0' && !validateInput(parentId, 'id')) throw new ValidationError('父ID无效');

  const commentsPath = `comments/${postId}`;

  try {
    if (parentId !== '0') {
      const parent = await read(`${commentsPath}/${parentId}`);
      if (!parent) throw new ValidationError('父评论不存在');
    }

    const newRef = await write(commentsPath, null, { method: 'push' }); // push返回{ key }
    const commentId = newRef.key;

    const fullData = {
      id: commentId,
      name: name.trim(),
      email: email ? email.trim() : null,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0,
      totalLikes: 0,
      parentId,
      isGuest,
      children: {}
    };

    await write(`${commentsPath}/${commentId}`, fullData, { method: 'set' });

    if (parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${parentId}/children`;
      await transaction(parentChildrenPath, function(current) {
        const children = current || {};
        children[commentId] = true;
        return children;
      });
      await computeCommentTreeTotalLikes(postId, parentId);
      await updateCommentAncestorsTotalLikes(postId, parentId);
    }

    logger.success(`评论添加成功 (postId: ${postId}, commentId: ${commentId})`);
    return { success: true, data: fullData };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`添加评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to add comment');
  }
}

// 获取评论 (树形)
export async function fetchComments(postId) {
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');

  try {
    const commentsData = await read(`comments/${postId}`);

    if (!commentsData) {
      logger.info(`无评论 (postId: ${postId})`);
      return [];
    }

    const commentsMap = {};
    Object.values(commentsData).forEach(function(c) {
      if (!c || !c.id || !c.createdAt || !c.name || !c.content) {
        logger.warn(`无效评论 (postId: ${postId}, id: ${c ? c.id : 'unknown'})`, c);
        return;
      }
      c.children = c.children && typeof c.children === 'object' ? c.children : {};
      c.likes = c.likes || 0;
      c.totalLikes = c.totalLikes || 0;
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
          if (!parent._childrenArray) parent._childrenArray = [];
          parent._childrenArray.push(comment);
        } else {
          logger.warn(`孤立评论 (postId: ${postId}, id: ${comment.id})`);
          rootComments.push(comment);
        }
      }
    });

    function buildTree(comments) {
      comments.sort(function(a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
      comments.forEach(function(c) {
        if (c._childrenArray) {
          c.children = buildTree(c._childrenArray);
          delete c._childrenArray;
        } else {
          c.children = [];
        }
      });
      return comments;
    }

    const tree = buildTree(rootComments);
    logger.success(`获取评论成功 (postId: ${postId}, count: ${tree.length})`);
    return tree;

  } catch (error) {
    logger.error(`获取评论失败 (postId: ${postId}):`, error);
    throw new Error('Failed to fetch comments');
  }
}

// 删除评论
export async function removeComment(postId, commentId, requestingUserId, adminId) {
  adminId = adminId || 'yolialisproxy';
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID无效');
  if (!requestingUserId) throw new ValidationError('userId不能为空');

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) throw new ValidationError('评论不存在');

    const isAuthor = commentData.name === requestingUserId;
    const isAdmin = requestingUserId === adminId;

    if (!isAuthor && !isAdmin) throw new ValidationError('无权限删除');

    await del(commentPath);
    logger.success(`删除成功 (postId: ${postId}, commentId: ${commentId})`);

    if (commentData.parentId && commentData.parentId !== '0') {
      const parentChildrenPath = `comments/${postId}/${commentData.parentId}/children`;
      await transaction(parentChildrenPath, function(current) {
        const children = current || {};
        delete children[commentId];
        return children;
      });
      await computeCommentTreeTotalLikes(postId, commentData.parentId);
      await updateCommentAncestorsTotalLikes(postId, commentData.parentId);
    }

    return { success: true, message: '删除成功' };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`删除失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to remove comment');
  }
}

// 编辑评论
export async function updateComment(postId, commentId, content, requestingUserId) {
  if (!validateInput(postId, 'id')) throw new ValidationError('文章ID无效');
  if (!validateInput(commentId, 'id')) throw new ValidationError('评论ID无效');
  if (!validateInput(content, 'comment')) throw new ValidationError('内容无效');
  if (!requestingUserId) throw new ValidationError('userId不能为空');

  const commentPath = `comments/${postId}/${commentId}`;

  try {
    const commentData = await read(commentPath);
    if (!commentData) throw new ValidationError('评论不存在');

    const isAuthor = commentData.name === requestingUserId;
    const isAdmin = requestingUserId === 'yolialisproxy';

    if (!isAuthor && !isAdmin) throw new ValidationError('无权限编辑');

    await write(commentPath, { content: content.trim(), updatedAt: new Date().toISOString() }, { method: 'update' });

    logger.success(`编辑成功 (postId: ${postId}, commentId: ${commentId})`);
    return { success: true, message: '编辑成功' };

  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error(`编辑失败 (postId: ${postId}, commentId: ${commentId}):`, error);
    throw new Error('Failed to update comment');
  }
}

// API handler
export async function commentApiHandler(req, res) {
  setCORS(res, req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  let body = {};
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    try {
      body = await parseBody(req);
    } catch (error) {
      logger.error('解析失败', error);
      return new Response(JSON.stringify({ success: false, message: 'Invalid body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const urlParams = new URL(req.url).searchParams;
  const postId = urlParams.get('postId') || body.postId;
  const commentId = urlParams.get('commentId') || body.commentId;
  const requestingUserId = body.userId;

  try {
    let result;
    switch (req.method) {
      case 'POST':
        result = await addComment({
          postId,
          name: body.name,
          email: body.email,
          content: body.comment,
          parentId: body.parentId,
          isGuest: body.isGuest,
        });
        break;
      case 'GET':
        result = await fetchComments(postId);
        break;
      case 'DELETE':
        if (!requestingUserId) throw new ValidationError('需userId');
        result = await removeComment(postId, commentId, requestingUserId);
        break;
      case 'PUT':
        if (!requestingUserId) throw new ValidationError('需userId');
        result = await updateComment(postId, commentId, body.comment, requestingUserId);
        break;
      default:
        return new Response(JSON.stringify({ success: false, message: `Method ${req.method} Not Allowed` }), {
          status: 405,
          headers: { 'Allow': 'GET, POST, PUT, DELETE, OPTIONS', 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logger.error('API失败', error, { postId, commentId, method: req.method });
    const status = error.name === 'ValidationError' ? 400 : 500;
    const message = process.env.NODE_ENV === 'development' ? error.message : 'Server error';
    return new Response(JSON.stringify({ success: false, message }), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handler(req, res) {
  commentApiHandler(req, res);
}
