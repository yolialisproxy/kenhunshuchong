import { initFirebase, ref, push, set, get, update, remove, runTransaction, parseBody, setCORS, withTimeout } from '../lib/utils.js';
console.log('✅ api/comments.js 导入 lib/utils.js 成功');

// 计算总赞数，带无限容错
async function computeTotalLikes(postId, commentId, depth = 0) {
  if (depth > 50) {
    console.warn(`⚠️ 递归深度超过50 (postId: ${postId}, commentId: ${commentId})`);
    return 0;
  }

  let attempt = 0, maxInitialRetries = 5, retryInterval = 1000;
  while (true) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 5000);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return 0;
      }

      const comment = snapshot.val();
      let total = comment.likes || 0;

      if (comment.children && Array.isArray(comment.children)) {
        for (const child of comment.children) {
          if (!child?.id) {
            console.warn(`⚠️ 无效子评论ID (postId: ${postId}, commentId: ${commentId})`);
            continue;
          }
          const childTotal = await computeTotalLikes(postId, child.id, depth + 1);
          await withTimeout(update(ref(initFirebase(), `comments/${postId}/${child.id}`), { totalLikes: childTotal, lastSync: Date.now() }), 5000);
          total += childTotal;
        }
      }

      await withTimeout(update(commentRef, { totalLikes: total, lastSync: Date.now() }), 5000);
      return total;
    } catch (err) {
      attempt++;
      if (attempt <= maxInitialRetries) {
        console.error(`❌ computeTotalLikes 尝试${attempt}失败 (postId: ${postId}, commentId: ${commentId}):`, err.stack);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, 5000); // 动态增加间隔
        continue;
      }

      // 后备方案1：重建评论树
      console.log(`⚠️ computeTotalLikes 重试失败，尝试重建评论树 (postId: ${postId})`);
      try {
        const commentsRef = ref(initFirebase(), `comments/${postId}`);
        const snapshot = await withTimeout(get(commentsRef), 5000);
        if (snapshot.exists()) {
          const comments = snapshot.val();
          for (const c of Object.values(comments)) {
            if (c.id === commentId || c.children?.some(child => child.id === commentId)) {
              await computeTotalLikes(postId, c.id, depth + 1); // 重算相关评论
            }
          }
          return await computeTotalLikes(postId, commentId, depth); // 重试
        }
      } catch (rebuildErr) {
        console.error(`❌ 重建评论树失败 (postId: ${postId}):`, rebuildErr.stack);
      }

      // 后备方案2：返回默认值并记录
      console.error(`❌ computeTotalLikes 最终失败 (postId: ${postId}, commentId: ${commentId})，返回 0`);
      return 0;
    }
  }
}

// 提交评论
export async function submitComment(req, res) {
  setCORS(res); // 统一使用 setCORS
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  const { postId, name, email, comment, parentId = '0', isGuest = true } = body;

  if (!postId || !name || !email || !comment) {
    console.error(`❌ 提交评论失败：缺少必填字段`, { postId, name, email, comment });
    return res.status(400).json({ success: false, error: '缺少必填字段' });
  }

  let attempt = 0, maxInitialRetries = 5, retryInterval = 1000;
  while (true) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), 5000);

      let floor = 1;
      if (snapshot.exists()) {
        const comments = snapshot.val() || {};
        floor = Object.values(comments).filter(c => c.parentId === parentId).length + 1;
      }

      const newCommentRef = push(commentsRef);
      const data = {
        id: newCommentRef.key,
        name: String(name).trim(),
        email: String(email).trim(),
        comment: String(comment).trim(),
        date: Date.now(),
        likes: 0,
        totalLikes: 0,
        parentId,
        floor,
        isGuest,
        children: [],
        lastSync: Date.now()
      };

      await withTimeout(set(newCommentRef, data), 5000);

      if (parentId !== '0') {
        const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
        const parentSnapshot = await withTimeout(get(parentRef), 5000);
        if (!parentSnapshot.exists()) {
          console.warn(`⚠️ 父评论不存在 (postId: ${postId}, parentId: ${parentId})`);
        } else {
          const parentChildrenRef = ref(initFirebase(), `comments/${postId}/${parentId}/children`);
          await withTimeout(runTransaction(parentChildrenRef, (current) => {
            if (!current) current = [];
            current.push({ id: newCommentRef.key });
            return current;
          }), 5000);
          await computeTotalLikes(postId, parentId);
        }
      }

      return res.status(200).json({ success: true, data });
    } catch (err) {
      attempt++;
      if (attempt <= maxInitialRetries) {
        console.error(`❌ 提交评论尝试${attempt}失败:`, err.stack);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, 5000);
        continue;
      }

      // 后备方案1：检查父评论并重试
      if (parentId !== '0') {
        console.log(`⚠️ 提交评论失败，检查父评论 (postId: ${postId}, parentId: ${parentId})`);
        try {
          const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
          const parentSnapshot = await withTimeout(get(parentRef), 5000);
          if (!parentSnapshot.exists()) {
            console.warn(`⚠️ 父评论不存在，重置为顶层评论`);
            body.parentId = '0';
            return await submitComment(req, res); // 重试
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
  } catch (err) {
    console.error(`❌ 解析请求体失败:`, err.stack);
    return res.status(400).json({ success: false, error: '无效的请求体' });
  }

  if (!postId) {
    console.error(`❌ 获取评论失败：缺少 postId`, { postId });
    return res.status(400).json({ success: false, error: '缺少 postId 参数' });
  }

  let attempt = 0, maxInitialRetries = 5, retryInterval = 1000;
  while (true) {
    try {
      const commentsRef = ref(initFirebase(), `comments/${postId}`);
      const snapshot = await withTimeout(get(commentsRef), 5000);
      if (!snapshot.exists()) {
        console.log(`✅ 无评论数据 (postId: ${postId})`);
        return res.status(200).json({ success: true, data: [] });
      }

      const comments = snapshot.val();
      if (!comments || typeof comments !== 'object') {
        console.warn(`⚠️ comments 数据无效 (postId: ${postId}):`, comments);
        return res.status(200).json({ success: true, data: [] });
      }

      // 数据一致性检查
      const commentMap = {};
      Object.values(comments).forEach(c => {
        if (!c?.id || !c?.lastSync) {
          console.warn(`⚠️ 无效评论数据 (postId: ${postId}, commentId: ${c?.id})`, c);
          return;
        }
        c.children = Array.isArray(c.children) ? c.children : [];
        c.totalLikes = c.totalLikes || 0;
        c.lastSync = c.lastSync || Date.now();
        if (Date.now() - c.lastSync > 5 * 60 * 1000) {
          console.log(`⚠️ 检测到陈旧数据 (commentId: ${c.id})，触发重算 totalLikes`);
          computeTotalLikes(postId, c.id).catch(err => console.error(`❌ 重算 totalLikes 失败:`, err.stack));
        }
        commentMap[c.id] = c;
      });

      const tree = [];
      Object.values(commentMap).forEach(c => {
        if (c.parentId === '0') {
          tree.push(c);
        } else {
          const parent = commentMap[c.parentId];
          if (parent) {
            parent.children = Array.isArray(parent.children) ? parent.children : [];
            parent.children.push(c);
          } else {
            console.warn(`⚠️ 孤立评论 (postId: ${postId}, commentId: ${c.id})，归入顶层`);
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
      if (attempt <= maxInitialRetries) {
        console.error(`❌ 获取评论尝试${attempt}失败 (postId: ${postId}):`, err.stack);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, 5000);
        continue;
      }

      // 后备方案1：检查数据库连接并重试
      console.log(`⚠️ 获取评论失败，检查数据库连接 (postId: ${postId})`);
      try {
        const testRef = ref(initFirebase(), 'test');
        await withTimeout(get(testRef), 5000);
        attempt = 0; // 重置重试计数
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

  if (!postId || !commentId || !username) {
    console.error(`❌ 删除评论失败：缺少必要参数`, { postId, commentId, username });
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }

  if (username !== 'yolialisproxy') {
    console.error(`❌ 删除评论失败：无权限 (username: ${username})`);
    return res.status(403).json({ success: false, error: '没有权限删除评论' });
  }

  let attempt = 0, maxInitialRetries = 5, retryInterval = 1000;
  while (true) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 5000);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      const comment = snapshot.val();
      const parentId = comment.parentId || '0';

      await withTimeout(remove(commentRef), 5000);

      if (parentId !== '0') {
        const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
        const parentSnapshot = await withTimeout(get(parentRef), 5000);
        if (parentSnapshot.exists()) {
          const parentChildrenRef = ref(initFirebase(), `comments/${postId}/${parentId}/children`);
          await withTimeout(runTransaction(parentChildrenRef, (current) => {
            if (current) {
              return current.filter(child => child.id !== commentId);
            }
            return current;
          }), 5000);
          await computeTotalLikes(postId, parentId);
        }
      }

      return res.status(200).json({ success: true, message: '删除成功' });
    } catch (err) {
      attempt++;
      if (attempt <= maxInitialRetries) {
        console.error(`❌ 删除评论尝试${attempt}失败:`, err.stack);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, 5000);
        continue;
      }

      // 后备方案1：检查父评论并重试
      if (parentId !== '0') {
        console.log(`⚠️ 删除评论失败，检查父评论 (postId: ${postId}, parentId: ${parentId})`);
        try {
          const parentRef = ref(initFirebase(), `comments/${postId}/${parentId}`);
          const parentSnapshot = await withTimeout(get(parentRef), 5000);
          if (!parentSnapshot.exists()) {
            console.warn(`⚠️ 父评论不存在，跳过更新`);
            await withTimeout(remove(commentRef), 5000);
            return res.status(200).json({ success: true, message: '删除成功（父评论缺失）' });
          }
        } catch (parentErr) {
          console.error(`❌ 检查父评论失败:`, parentErr.stack);
        }
      }

      // 后备方案2：强制删除并记录
      console.error(`❌ 删除评论最终失败 (postId: ${postId}, commentId: ${commentId})`);
      try {
        await withTimeout(remove(commentRef), 5000);
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

  if (!postId || !commentId || !comment) {
    console.error(`❌ 编辑评论失败：缺少必要参数`, { postId, commentId, comment });
    return res.status(400).json({ success: false, error: '缺少必要参数' });
  }

  let attempt = 0, maxInitialRetries = 5, retryInterval = 1000;
  while (true) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), 5000);
      if (!snapshot.exists()) {
        console.warn(`⚠️ 评论不存在 (postId: ${postId}, commentId: ${commentId})`);
        return res.status(404).json({ success: false, error: '评论不存在' });
      }

      await withTimeout(update(commentRef, { comment: String(comment).trim(), lastSync: Date.now() }), 5000);
      return res.status(200).json({ success: true, message: '编辑成功' });
    } catch (err) {
      attempt++;
      if (attempt <= maxInitialRetries) {
        console.error(`❌ 编辑评论尝试${attempt}失败:`, err.stack);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        retryInterval = Math.min(retryInterval + 1000, 5000);
        continue;
      }

      // 后备方案1：检查评论存在并重试
      console.log(`⚠️ 编辑评论失败，重新检查评论 (postId: ${postId}, commentId: ${commentId})`);
      try {
        const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
        const snapshot = await withTimeout(get(commentRef), 5000);
        if (!snapshot.exists()) {
          return res.status(404).json({ success: false, error: '评论不存在' });
        }
        attempt = 0; // 重置重试计数
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
  setCORS(res); // 统一使用 setCORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
