// 状态回顾：修复导出为CommonJS，优化computeTotalLikes，基于2025-08-22优化
const { initFirebase, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS, withTimeout, validateInput, CONFIG } = require('../lib/utils.js');
console.log('✅ api/comments.js加载utils.js成功');

async function computeTotalLikes(postId, commentId, depth = 0, cache = new Map()) {
  if (depth > CONFIG.MAX_RECURSION_DEPTH) {
    console.warn(`⚠️ 递归深度超过${CONFIG.MAX_RECURSION_DEPTH} (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    console.error(`❌ 无效的 postId 或 commentId:`, { postId, commentId });
    return 0;
  }

  if (cache.has(commentId)) return cache.get(commentId);

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return 0;
      }

      const comment = snapshot.val();
      let total = comment.likes || 0;

      if (Array.isArray(comment.children) && comment.children.length > 0) {
        const childPromises = comment.children.map(child =>
          validateInput(child.id, 'id') ? computeTotalLikes(postId, child.id, depth + 1, cache) : Promise.resolve(0)
        );
        const childTotals = await Promise.all(childPromises);
        total += childTotals.reduce((sum, val) => sum + val, 0);

        const updates = {};
        comment.children.forEach((child, idx) => {
          if (validateInput(child.id, 'id')) {
            updates[`comments/${postId}/${child.id}/totalLikes`] = childTotals[idx];
            updates[`comments/${postId}/${child.id}/lastSync`] = Date.now();
          }
        });
        if (Object.keys(updates).length > 0) {
          await withTimeout(update(ref(initFirebase()), updates), CONFIG.TIMEOUT);
        }
      }

      await withTimeout(update(commentRef, { totalLikes: total, lastSync: Date.now() }), CONFIG.TIMEOUT);
      cache.set(commentId, total);
      return total;
    } catch (err) {
      attempt++;
      console.error(`❌ computeTotalLikes 尝试${attempt}失败:`, err.stack);
      if (attempt > CONFIG.MAX_RETRIES) {
        console.error(`❌ computeTotalLikes 最终失败，返回缓存或0`);
        return cache.get(commentId) || 0;
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

async function submitComment(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, name, email, comment, parentId = '0', isGuest = true, username } = body;

  if (
    !validateInput(postId, 'id') ||
    !validateInput(name, 'name') ||
    !validateInput(email, 'email') ||
    !validateInput(comment, 'comment') ||
    !validateInput(parentId, 'id')
  ) {
    console.error(`❌ 提交评论失败：无效参数`, { postId, name, email, comment, parentId });
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
        name: name.trim(),
        email: email.trim(),
        comment: comment.trim(),
        parentId,
        isGuest,
        username: username?.trim() || name.trim(),
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

      return res.status(201).json({ success: true, commentId, message: '评论提交成功' });
    } catch (err) {
      attempt++;
      console.error(`❌ 提交评论尝试${attempt}失败:`, err.stack);
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

  const { postId } = req.query;
  if (!validateInput(postId, 'id')) {
    console.error(`❌ 获取评论失败：无效 postId`, { postId });
    return res.status(400).json({ success: false, error: '无效的 postId' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), CONFIG.TIMEOUT);
      const comments = snapshot.val() || {};
      const commentList = Object.values(comments);
      return res.status(200).json({ success: true, comments: commentList });
    } catch (err) {
      attempt++;
      console.error(`❌ 获取评论尝试${attempt}失败:`, err.stack);
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
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, commentId, username } = body;

  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id') || !validateInput(username, 'username')) {
    console.error(`❌ 删除评论失败：无效参数`, { postId, commentId, username });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      const comment = snapshot.val();
      if (comment.username !== username && username !== 'yolialisproxy') {
        console.error(`❌ 删除评论失败：无权限`, { username, commentUsername: comment.username });
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
      console.error(`❌ 删除评论尝试${attempt}失败:`, err.stack);
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
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, commentId, comment, username } = body;

  if (
    !validateInput(postId, 'id') ||
    !validateInput(commentId, 'id') ||
    !validateInput(comment, 'comment') ||
    !validateInput(username, 'username')
  ) {
    console.error(`❌ 编辑评论失败：无效参数`, { postId, commentId, comment, username });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= CONFIG.MAX_RETRIES) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      const existingComment = snapshot.val();
      if (existingComment.username !== username && username !== 'yolialisproxy') {
        console.error(`❌ 编辑评论失败：无权限`, { username, commentUsername: existingComment.username });
        return res.status(403).json({ success: false, error: '没有权限编辑评论' });
      }

      await withTimeout(update(commentRef, { comment: comment.trim(), lastSync: Date.now() }), CONFIG.TIMEOUT);
      return res.status(200).json({ success: true, message: '编辑成功' });
    } catch (err) {
      attempt++;
      console.error(`❌ 编辑评论尝试${attempt}失败:`, err.stack);
      if (attempt > CONFIG.MAX_RETRIES) {
        return res.status(503).json({ success: false, error: '编辑失败，请稍后重试', details: err.message });
      }
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

module.exports = { submitComment, getComments, deleteComment, editComment };
