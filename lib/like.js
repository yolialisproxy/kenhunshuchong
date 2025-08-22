// lib/likes.js
import { db, validateInput } from './utils.js';

// 添加点赞
export async function addLike(likeData) {
  // 验证输入
  const validationErrors = validateInput(likeData, ['userId', 'postId']);
  if (validationErrors) {
    const error = new Error('输入验证失败');
    error.name = 'ValidationError';
    error.message = validationErrors.join(', ');
    throw error;
  }

  try {
    // 检查用户是否已经点赞
    const existingLike = await db.get(`likes/${likeData.userId}_${likeData.postId}`);
    if (existingLike) {
      const error = new Error('用户已经点赞过此内容');
      error.name = 'ValidationError';
      throw error;
    }

    // 添加点赞记录
    const likeId = `${likeData.userId}_${likeData.postId}`;
    await db.set(`likes/${likeId}`, {
      ...likeData,
      createdAt: new Date().toISOString()
    });

    // 更新帖子点赞数
    const post = await db.get(`posts/${likeData.postId}`);
    if (post) {
      await db.update(`posts/${likeData.postId}`, {
        likes: (post.likes || 0) + 1
      });
    }

    return { id: likeId, ...likeData };
  } catch (error) {
    console.error('添加点赞失败:', error);
    throw error;
  }
}

// 移除点赞
export async function removeLike(likeData) {
  // 验证输入
  const validationErrors = validateInput(likeData, ['userId', 'postId']);
  if (validationErrors) {
    const error = new Error('输入验证失败');
    error.name = 'ValidationError';
    error.message = validationErrors.join(', ');
    throw error;
  }

  try {
    const likeId = `${likeData.userId}_${likeData.postId}`;

    // 检查点赞是否存在
    const existingLike = await db.get(`likes/${likeId}`);
    if (!existingLike) {
      const error = new Error('点赞记录不存在');
      error.name = 'ValidationError';
      throw error;
    }

    // 删除点赞记录
    await db.remove(`likes/${likeId}`);

    // 更新帖子点赞数
    const post = await db.get(`posts/${likeData.postId}`);
    if (post && post.likes > 0) {
      await db.update(`posts/${likeData.postId}`, {
        likes: post.likes - 1
      });
    }

    return true;
  } catch (error) {
    console.error('移除点赞失败:', error);
    throw error;
  }
}

// 获取点赞数
export async function getLikesCount(postId) {
  try {
    const likes = await db.get('likes');
    if (!likes) return 0;

    return Object.values(likes).filter(like => like.postId === postId).length;
  } catch (error) {
    console.error('获取点赞数失败:', error);
    throw error;
  }
}
