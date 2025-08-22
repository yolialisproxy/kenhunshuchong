// lib/like.js
import { ref, get, update, runTransaction, database } from './utils.js';

// 获取点赞数
export const getLikes = async (postId) => {
  try {
    const likesRef = ref(database, `likes/${postId}`);
    const snapshot = await get(likesRef);

    if (snapshot.exists()) {
      return snapshot.val().count || 0;
    }
    return 0;
  } catch (error) {
    console.error('Error getting likes:', error);
    throw new Error('Failed to get likes');
  }
};

// 添加点赞
export const addLike = async (postId, userId) => {
  try {
    const likesRef = ref(database, `likes/${postId}`);
    const userLikeRef = ref(database, `userLikes/${userId}/${postId}`);

    // 使用事务确保原子性
    await runTransaction(likesRef, (currentData) => {
      if (!currentData) {
        return { count: 1 };
      }
      return { count: (currentData.count || 0) + 1 };
    });

    // 记录用户点赞
    await update(userLikeRef, { liked: true, timestamp: Date.now() });

    return true;
  } catch (error) {
    console.error('Error adding like:', error);
    throw new Error('Failed to add like');
  }
};

// 移除点赞
export const removeLike = async (postId, userId) => {
  try {
    const likesRef = ref(database, `likes/${postId}`);
    const userLikeRef = ref(database, `userLikes/${userId}/${postId}`);

    // 使用事务确保原子性
    await runTransaction(likesRef, (currentData) => {
      if (!currentData || currentData.count <= 0) {
        return { count: 0 };
      }
      return { count: currentData.count - 1 };
    });

    // 移除用户点赞记录
    await update(userLikeRef, { liked: false, timestamp: Date.now() });

    return true;
  } catch (error) {
    console.error('Error removing like:', error);
    throw new Error('Failed to remove like');
  }
};

// 检查用户是否已点赞
export const checkUserLike = async (postId, userId) => {
  try {
    const userLikeRef = ref(database, `userLikes/${userId}/${postId}`);
    const snapshot = await get(userLikeRef);

    if (snapshot.exists()) {
      return snapshot.val().liked || false;
    }
    return false;
  } catch (error) {
    console.error('Error checking user like:', error);
    throw new Error('Failed to check user like');
  }
};
