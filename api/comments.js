// api/comments.js
const { ref, push, set, get, update, remove, runTransaction, parseBody, setCORS, withTimeout, validateInput, CONFIG, logger, computeTotalLikes, sanitizeInput } = require('../lib/utils.js');
const jwt = require('jsonwebtoken');

console.log('✅ api/comments.js加载utils.js成功');

async function submitComment(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    logger.error('解析请求体失败', { error: err.message, stack: err.stack });
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, name, email, comment, parentId = '0', isGuest = true, username } = body;
  const token = req.headers.authorization?.split(' ')[1];

  if (!token && !isGuest) {
    logger.error('未提供JWT', { username });
    return res.status(401).json({ success: false, error: '未授权' });
  }

  try {
    if (!isGuest) jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logger.error('JWT验证失败', { error: err.message });
    return res.status(401).json({ success: false, error: '无效的令牌' });
  }

  if (
    !validateInput(postId, 'id') ||
    !validateInput(name, 'name') ||
    !validateInput(email, 'email') ||
    !validateInput(sanitizeInput(comment), 'comment') ||
    !validateInput(parentId, 'id')
  ) {
    logger.error('提交评论失败：无效参数', { postId, name, email, comment, parentId });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const newCommentRef = push(commentsRef);
      const commentId = newCommentRef.key;
      const commentData = {
        id: commentId,
        postId,
        name: sanitizeInput(name.trim()),
        email: sanitizeInput(email.trim()),
        comment: sanitizeInput(comment.trim()),
        parentId,
        isGuest,
        username: sanitizeInput(username?.trim() || name.trim()),
        createdAt: Date.now(),
        likes: 0,
        totalLikes: 0,
        children: [],
      };

      await withTimeout(set(newCommentRef, commentData), CONFIG.TIMEOUT);

      if (parentId !== '0') {
        const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
        await withTimeout(
          runTransaction(parentRef, current => {
            if (current) {
              current.children = current.children || [];
              current.children.push({ id: commentId });
              return current;
            }
            return current;
          }),
          CONFIG.TIMEOUT
        );
        await computeTotalLikes(postId, parentId);
      }

      // 触发通知
      await triggerNotification(postId, commentId, parentId, username);

      return res.status(201).json({ success: true, commentId, message: '评论提交成功' });
    } catch (err) {
      attempt++;
      logger.error(`提交评论尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(503).json({ success: false, error: '提交失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

async function getComments(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { postId, limit = 10, offset = 0 } = req.query;
  if (!validateInput(postId, 'id') || !Number.isInteger(Number(limit)) || !Number.isInteger(Number(offset))) {
    logger.error('获取评论失败：无效参数', { postId, limit, offset });
    return res.status(400).json({ success: false, error: '无效的 postId、limit 或 offset' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const cacheKey = `comments:${postId}:${limit}:${offset}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info('从缓存获取评论', { postId, limit, offset });
        return res.status(200).json({ success: true, comments: JSON.parse(cached) });
      }

      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), CONFIG.TIMEOUT);
      let comments = snapshot.val() || {};
      const commentList = Object.values(comments).slice(Number(offset), Number(offset) + Number(limit));
      await redis.set(cacheKey, JSON.stringify(commentList), 'EX', CONFIG.CACHE_TTL);
      return res.status(200).json({ success: true, comments: commentList });
    } catch (err) {
      attempt++;
      logger.error(`获取评论尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(503).json({ success: false, error: '获取失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

async function deleteComment(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    logger.error('解析请求体失败', { error: err.message, stack: err.stack });
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, commentId, username } = body;
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    logger.error('未提供JWT', { username });
    return res.status(401).json({ success: false, error: '未授权' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logger.error('JWT验证失败', { error: err.message });
    return res.status(401).json({ success: false, error: '无效的令牌' });
  }

  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id') || !validateInput(username, 'username')) {
    logger.error('删除评论失败：无效参数', { postId, commentId, username });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        logger.warn('评论不存在', { postId, commentId });
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      const comment = snapshot.val();
      if (comment.username !== username && username !== 'yolialisproxy') {
        logger.error('删除评论失败：无权限', { username, commentUsername: comment.username });
        return res.status(403).json({ success: false, error: '没有权限删除评论' });
      }

      const parentId = comment.parentId || '0';
      await withTimeout(remove(commentRef), CONFIG.TIMEOUT);

      if (parentId !== '0') {
        const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
        const parentSnapshot = await withTimeout(get(parentRef), CONFIG.TIMEOUT);
        if (parentSnapshot.exists()) {
          const parentChildrenRef = ref(initFirebase(), `comments/${postId}/${parentId}/children`);
          await withTimeout(
            runTransaction(parentChildrenRef, current => {
              if (current) return current.filter(child => child.id !== commentId);
              return current;
            }),
            CONFIG.TIMEOUT
          );
          await computeTotalLikes(postId, parentId);
        }
      }

      return res.status(200).json({ success: true, message: '删除成功' });
    } catch (err) {
      attempt++;
      logger.error(`删除评论尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(503).json({ success: false, error: '删除失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

async function editComment(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    logger.error('解析请求体失败', { error: err.message, stack: err.stack });
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, commentId, comment, username } = body;
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    logger.error('未提供JWT', { username });
    return res.status(401).json({ success: false, error: '未授权' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logger.error('JWT验证失败', { error: err.message });
    return res.status(401).json({ success: false, error: '无效的令牌' });
  }

  if (
    !validateInput(postId, 'id') ||
    !validateInput(commentId, 'id') ||
    !validateInput(sanitizeInput(comment), 'comment') ||
    !validateInput(username, 'username')
  ) {
    logger.error('编辑评论失败：无效参数', { postId, commentId, comment, username });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        logger.warn('评论不存在', { postId, commentId });
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      const existingComment = snapshot.val();
      if (existingComment.username !== username && username !== 'yolialisproxy') {
        logger.error('编辑评论失败：无权限', { username, commentUsername: existingComment.username });
        return res.status(403).json({ success: false, error: '没有权限编辑评论' });
      }

      await withTimeout(update(commentRef, { comment: sanitizeInput(comment.trim()), lastSync: Date.now() }), CONFIG.TIMEOUT);
      return res.status(200).json({ success: true, message: '编辑成功' });
    } catch (err) {
      attempt++;
      logger.error(`编辑评论尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(503).json({ success: false, error: '编辑失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

// 通知触发器
async function triggerNotification(postId, commentId, parentId, username) {
  try {
    const notificationRef = ref(initFirebase(), `notifications/${postId}`);
    const notificationData = {
      id: push(notificationRef).key,
      postId,
      commentId,
      parentId,
      username,
      type: parentId === '0' ? 'new_comment' : 'reply',
      createdAt: Date.now(),
    };
    await withTimeout(set(push(notificationRef), notificationData), CONFIG.TIMEOUT);
    logger.info('通知触发成功', { postId, commentId, username });
  } catch (err) {
    logger.error('通知触发失败', { error: err.message, stack: err.stack });
  }
}

export async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

    switch (req.method) {
      case 'POST':
        return await submitComment(req, res);
      case 'GET':
        return await getComments(req, res);
      case 'DELETE':
        return await deleteComment(req, res);
      case 'PUT':
        return await editComment(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error('服务器错误', { error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: '服务器错误，请稍后重试', details: err.message });
  }
};

module.exports = { submitComment, getComments, deleteComment, editComment };
