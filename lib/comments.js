// 状态回顾：基于2025-08-21移除Firebase SDK前端访问，使用Vercel API。本次优化增强性能、安全性、容错，确保与前端comments.js（2025-08-22）无缝协作
import { initFirebase, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
console.log('✅ api/comments.js 导入 lib/utils.js 成功');

// 配置常量
const CONFIG = {
  TIMEOUT: 5000,
  MAX_INITIAL_RETRIES: 5,
  MAX_RETRY_INTERVAL: 5000,
  MAX_RECURSION_DEPTH: 50,
  MAX_COMMENT_LENGTH: 1000,
  MAX_NAME_LENGTH: 50,
};

// 输入验证
function validateInput(input, type = 'text') {
  if (typeof input !== 'string') return false;
  if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  if (type === 'name') return input.length > 0 && input.length <= CONFIG.MAX_NAME_LENGTH;
  if (type === 'comment') return input.length > 0 && input.length <= CONFIG.MAX_COMMENT_LENGTH;
  if (type === 'id') return /^[a-zA-Z0-9_-]+$/.test(input);
  return true;
}

// 计算总赞数，带无限容错和批量优化
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
  while (true) {
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
          validateInput(child.id, 'id')
            ? computeTotalLikes(postId, child.id, depth + 1, cache)
            : Promise.resolve(0)
        );
        const childTotals = await Promise.all(childPromises);
        total += childTotals.reduce((sum, val) => sum + val, 0);

        // 批量更新子评论的 totalLikes
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

      // 更新当前评论的 totalLikes
      await withTimeout(
        update(commentRef, { totalLikes: total, lastSync: Date.now() }),
        CONFIG.TIMEOUT
      );
      cache.set(commentId, total);
      return total;
    } catch (err) {
      attempt++;
      console.error(`❌ computeTotalLikes 尝试${attempt}失败 (postId: ${postId}, commentId: ${commentId}):`, err.stack);
      if (attempt <= CONFIG.MAX_INITIAL_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRY_INTERVAL);
        continue;
      }

      // 后备方案1：检查数据库连接并重试
      console.log(`⚠️ computeTotalLikes 重试失败，检查数据库连接 (postId: ${postId})`);
      try {
        const testRef = ref(initFirebase(), 'test');
        await withTimeout(get(testRef), CONFIG.TIMEOUT);
        attempt = 0;
        continue;
      } catch (testErr) {
        console.error(`❌ 数据库连接检查失败:`, testErr.stack);
      }

      // 后备方案2：尝试从缓存获取
      if (cache.has(commentId)) {
        console.warn(`⚠️ 使用缓存值 (commentId: ${commentId})`);
        return cache.get(commentId);
      }

      // 后备方案3：返回默认值并记录
      console.error(`❌ computeTotalLikes 最终失败 (postId: ${postId}, commentId: ${commentId})，返回 0`);
      return 0;
    }
  }
}

// 提交评论
export async function submitComment(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, name, email, comment, parentId = '0', isGuest = true } = body;

  if (
    !validateInput(postId, 'id') ||
    !validateInput(name, 'name') ||
    !validateInput(email, 'email') ||
    !validateInput(comment, 'comment') ||
    !validateInput(parentId, 'id')
  ) {
    console.error(`❌ 提交评论失败：无效字段`, { postId, name, email, comment, parentId });
    return res.status(400).json({ success: false, error: '无效的字段值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (true) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), CONFIG.TIMEOUT);

      let floor = 1;
      if (snapshot.exists()) {
        const comments = snapshot.val() || {};
        floor = Object.values(comments).filter(c => c.parentId === parentId).length + 1;
      }

      const newCommentRef = push(commentsRef);
      const data = {
        id: newCommentRef.key,
        name: name.trim(),
        email: email.trim(),
        comment: comment.trim(),
        date: Date.now(),
        likes: 0,
        totalLikes: 0,
        parentId,
        floor,
        isGuest,
        children: [],
        lastSync: Date.now(),
      };

      await withTimeout(set(newCommentRef, data), CONFIG.TIMEOUT);

      if (parentId !== '0') {
        const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
        const parentSnapshot = await withTimeout(get(parentRef), CONFIG.TIMEOUT);
        if (!parentSnapshot.exists()) {
          console.warn(`⚠️ 父评论不存在 (postId: ${postId}, parentId: ${parentId})`);
          data.parentId = '0'; // 重置为顶层评论
          await withTimeout(set(newCommentRef, data), CONFIG.TIMEOUT);
        } else {
          const parentChildrenRef = ref(initFirebase(), `comments/${postId}/${parentId}/children`);
          await withTimeout(
            runTransaction(parentChildrenRef, current => {
              if (!current) current = [];
              current.push({ id: newCommentRef.key });
              return current;
            }),
            CONFIG.TIMEOUT
          );
          await computeTotalLikes(postId, parentId);
        }
      }

      return res.status(200).json({ success: true, data });
    } catch (err) {
      attempt++;
      console.error(`❌ 提交评论尝试${attempt}失败:`, err.stack);
      if (attempt <= CONFIG.MAX_INITIAL_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRY_INTERVAL);
        continue;
      }

      // 后备方案1：检查父评论并重试
      if (parentId !== '0') {
        console.log(`⚠️ 提交评论失败，检查父评论 (postId: ${postId}, parentId: ${parentId})`);
        try {
          const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
          const parentSnapshot = await withTimeout(get(parentRef), CONFIG.TIMEOUT);
          if (!parentSnapshot.exists()) {
            console.warn(`⚠️ 父评论不存在，重置为顶层评论`);
            body.parentId = '0';
            return await submitComment(req, res);
          }
        } catch (parentErr) {
          console.error(`❌ 检查父评论失败:`, parentErr.stack);
        }
      }

      // 后备方案2：记录失败并返回
      console.error(`❌ 提交评论最终失败 (postId: ${postId})`);
      return res.status(503).json({ success: false, error: '无法提交评论，请联系管理员', details: err.message });
    }
  }
}

// 获取评论
export async function getComments(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let postId;
  try {
    const body = await parseBody(req);
    postId = body.postId || req.query.postId;
    if (!validateInput(postId, 'id')) throw new Error('无效的 postId');
  } catch (err) {
    console.error(`❌ 解析请求体或参数失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体或 postId' });
  }

  let attempt = 0, retryInterval = 1000;
  while (true) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.log(`✅ 无评论数据 (postId: ${postId})`);
        return res.status(200).json({ success: true, data: [] });
      }

      const comments = snapshot.val();
      if (!comments || typeof comments !== 'object') {
        console.warn(`⚠️ comments 数据无效 (postId: ${postId}):`, comments);
        return res.status(200).json({ success: true, data: [] });
      }

      const commentMap = {};
      const cache = new Map();
      await Promise.all(
        Object.values(comments).map(async c => {
          if (!c?.id || !validateInput(c.id, 'id')) {
            console.warn(`⚠️ 无效评论数据 (postId: ${postId}, commentId: ${c?.id})`, c);
            return;
          }
          c.children = Array.isArray(c.children) ? c.children : [];
          c.totalLikes = c.totalLikes || 0;
          c.lastSync = c.lastSync || Date.now();
          if (Date.now() - c.lastSync > 5 * 60 * 1000) {
            console.log(`⚠️ 检测到陈旧数据 (commentId: ${c.id})，触发重算 totalLikes`);
            c.totalLikes = await computeTotalLikes(postId, c.id, 0, cache);
          }
          commentMap[c.id] = c;
        })
      );

      const tree = [];
      Object.values(commentMap).forEach(c => {
        if (c.parentId === '0' || !validateInput(c.parentId, 'id')) {
          tree.push(c);
        } else {
          const parent = commentMap[c.parentId];
          if (parent) {
            parent.children = Array.isArray(parent.children) ? parent.children : [];
            parent.children.push(c);
          } else {
            console.warn(`⚠️ 孤立评论 (postId: ${postId}, commentId: ${c.id})，归入顶层`);
            c.parentId = '0';
            tree.push(c);
          }
        }
      });

      function sortComments(arr) {
        arr.sort((a, b) => (a.floor || 0) - (b.floor || 0));
        arr.forEach(c => {
          if (c.children?.length > 0) sortComments(c.children);
        });
      }
      sortComments(tree);

      return res.status(200).json({ success: true, data: tree });
    } catch (err) {
      attempt++;
      console.error(`❌ 获取评论尝试${attempt}失败 (postId: ${postId}):`, err.stack);
      if (attempt <= CONFIG.MAX_INITIAL_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRY_INTERVAL);
        continue;
      }

      // 后备方案1：检查数据库连接并重试
      console.log(`⚠️ 获取评论失败，检查数据库连接 (postId: ${postId})`);
      try {
        const testRef = ref(initFirebase(), 'test');
        await withTimeout(get(testRef), CONFIG.TIMEOUT);
        attempt = 0;
        continue;
      } catch (testErr) {
        console.error(`❌ 数据库连接检查失败:`, testErr.stack);
      }

      // 后备方案2：返回空数据并记录
      console.error(`❌ 获取评论最终失败 (postId: ${postId})`);
      return res.status(503).json({ success: false, error: '无法加载评论，请联系管理员', details: err.message });
    }
  }
}

// 删除评论
export async function deleteComment(req, res) {
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

  if (
    !validateInput(postId, 'id') ||
    !validateInput(commentId, 'id') ||
    !validateInput(username, 'name')
  ) {
    console.error(`❌ 删除评论失败：无效参数`, { postId, commentId, username });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  if (username !== 'yolialisproxy') {
    console.error(`❌ 删除评论失败：无权限 (username: ${username})`);
    return res.status(403).json({ success: false, error: '没有权限删除评论' });
  }

  let attempt = 0, retryInterval = 1000;
  while (true) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      const comment = snapshot.val();
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
      if (attempt <= CONFIG.MAX_INITIAL_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRY_INTERVAL);
        continue;
      }

      // 后备方案1：检查父评论并重试
      if (parentId !== '0') {
        console.log(`⚠️ 删除评论失败，检查父评论 (postId: ${postId}, parentId: ${parentId})`);
        try {
          const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
          const parentSnapshot = await withTimeout(get(parentRef), CONFIG.TIMEOUT);
          if (!parentSnapshot.exists()) {
            console.warn(`⚠️ 父评论不存在，跳过更新`);
            await withTimeout(remove(commentRef), CONFIG.TIMEOUT);
            return res.status(200).json({ success: true, message: '删除成功（父评论缺失）' });
          }
        } catch (parentErr) {
          console.error(`❌ 检查父评论失败:`, parentErr.stack);
        }
      }

      // 后备方案2：强制删除并记录
      console.error(`❌ 删除评论最终失败 (postId: ${postId}, commentId: ${commentId})`);
      try {
        await withTimeout(remove(commentRef), CONFIG.TIMEOUT);
        return res.status(200).json({ success: true, message: '强制删除成功' });
      } catch (forceErr) {
        console.error(`❌ 强制删除失败:`, forceErr.stack);
        return res.status(503).json({ success: false, error: '删除失败，请联系管理员', details: err.message });
      }
    }
  }
}

// 编辑评论
export async function editComment(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, commentId, comment } = body;

  if (
    !validateInput(postId, 'id') ||
    !validateInput(commentId, 'id') ||
    !validateInput(comment, 'comment')
  ) {
    console.error(`❌ 编辑评论失败：无效参数`, { postId, commentId, comment });
    return res.status(400).json({ success: false, error: '无效的参数值' });
  }

  let attempt = 0, retryInterval = 1000;
  while (true) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      await withTimeout(
        update(commentRef, { comment: comment.trim(), lastSync: Date.now() }),
        CONFIG.TIMEOUT
      );
      return res.status(200).json({ success: true, message: '编辑成功' });
    } catch (err) {
      attempt++;
      console.error(`❌ 编辑评论尝试${attempt}失败:`, err.stack);
      if (attempt <= CONFIG.MAX_INITIAL_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRY_INTERVAL);
        continue;
      }

      // 后备方案1：检查评论存在并重试
      console.log(`⚠️ 编辑评论失败，重新检查评论 (postId: ${postId}, commentId: ${commentId})`);
      try {
        const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
        const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
        if (!snapshot.exists()) {
          return res.status(404).json({ success: false, error: '评论不存在' });
        }
        attempt = 0;
        continue;
      } catch (checkErr) {
        console.error(`❌ 检查评论失败:`, checkErr.stack);
      }

      // 后备方案2：记录失败并返回
      console.error(`❌ 编辑评论最终失败 (postId: ${postId}, commentId: ${commentId})`);
      return res.status(503).json({ success: false, error: '编辑失败，请联系管理员', details: err.message });
    }
  }
}

// 主处理函数
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
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
        console.error(`❌ 不支持的请求方法: ${req.method}`);
        return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
    }
  } catch (err) {
    console.error('❌ 服务器错误:', err.stack);
    return res.status(503).json({ success: false, error: '服务器错误，请联系管理员', details: err.message });
  }
}
