// api/like.js
const path = require('path');
const { initFirebase, ref, get, update, runTransaction, withTimeout, validateInput, CONFIG, logger, computeTotalLikes } = require(path.resolve(__dirname, '../lib/utils.js'));
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('✅ api/like.js加载utils.js成功');

async function likeComment(postId, commentId, maxRetries = CONFIG.MAX_RETRIES) {
  if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
    logger.error('无效的 postId 或 commentId', { postId, commentId });
    throw new Error('无效的 postId 或 commentId');
  }

  const rateLimitKey = `rate:like:${postId}:${commentId}`;
  const rateLimitCount = await redis.incr(rateLimitKey);
  await redis.expire(rateLimitKey, 60); // 1分钟窗口
  if (rateLimitCount > 5) {
    logger.warn('点赞频率过高', { postId, commentId });
    throw new Error('点赞频率过高，请稍后重试');
  }

  let attempt = 0, retryInterval = 1000;
  while (attempt <= maxRetries) {
    try {
      const commentRef = ref(initFirebase(), `comments/${postId}/${commentId}`);
      const snapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      if (!snapshot.exists()) {
        logger.warn('评论不存在', { postId, commentId });
        throw Object.assign(new Error('评论不存在'), { isGhostLike: true });
      }

      await withTimeout(
        runTransaction(ref(initFirebase(), `comments/${postId}/${commentId}/likes`), current => (current || 0) + 1),
        CONFIG.TIMEOUT
      );

      async function updateAncestorsTotalLikes(currCommentId) {
        let currentId = currCommentId;
        while (currentId !== '0') {
          await computeTotalLikes(postId, currentId);
          const currSnapshot = await withTimeout(get(ref(initFirebase(), `comments/${postId}/${currentId}`)), CONFIG.TIMEOUT);
          if (!currSnapshot.exists()) break;
          const curr = currSnapshot.val();
          currentId = curr.parentId || '0';
        }
      }

      await updateAncestorsTotalLikes(commentId);

      const updatedSnapshot = await withTimeout(get(commentRef), CONFIG.TIMEOUT);
      const updatedComment = updatedSnapshot.val();
      return {
        likes: updatedComment.likes || 0,
        totalLikes: updatedComment.totalLikes || 0,
        comment: updatedComment,
      };
    } catch (err) {
      attempt++;
      logger.error(`likeComment尝试${attempt}失败`, { error: err.message, stack: err.stack });
      if (err.isGhostLike) throw err;
      if (attempt > maxRetries) throw new Error('点赞失败');
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(retryInterval + 1000, CONFIG.MAX_RETRIES * 1000);
    }
  }
}

export async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    req.body = await parseBody(req);
    const action = req.query.action;

    if (req.method === 'POST' && action === 'like') {
      const { postId, commentId } = req.body;
      if (!validateInput(postId, 'id') || !validateInput(commentId, 'id')) {
        logger.error('点赞失败：无效参数', { postId, commentId });
        return res.status(400).json({ success: false, message: '无效的 postId 或 commentId' });
      }
      try {
        const result = await likeComment(postId, commentId);
        return res.status(200).json({ success: true, ...result });
      } catch (error) {
        Sentry.captureException(error);
        logger.error('点赞错误', { error: error.message, stack: error.stack });
        if (error.isGhostLike) return res.status(410).json({ success: false, message: '评论不存在', ghostLike: true });
        return res.status(500).json({ success: false, message: '点赞失败，请稍后重试', details: error.message });
      }
    }
};

module.exports = { likeComment };
