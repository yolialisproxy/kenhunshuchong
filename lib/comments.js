// lib/comments.js
import { db, validateInput } from './utils.js';

// 获取所有评论
export async function getComments() {
  try {
    const comments = await db.get('comments');
    return comments ? Object.values(comments) : [];
  } catch (error) {
    console.error('获取评论失败:', error);
    throw error;
  }
}

// 添加评论
export async function addComment(commentData) {
  // 验证输入
  const validationErrors = validateInput(commentData, ['author', 'content', 'postId']);
  if (validationErrors) {
    const error = new Error('输入验证失败');
    error.name = 'ValidationError';
    error.message = validationErrors.join(', ');
    throw error;
  }

  try {
    // 添加时间戳
    const commentWithTimestamp = {
      ...commentData,
      createdAt: new Date().toISOString(),
      likes: 0
    };

    const commentId = await db.push('comments', commentWithTimestamp);
    return { id: commentId, ...commentWithTimestamp };
  } catch (error) {
    console.error('添加评论失败:', error);
    throw error;
  }
}

// 删除评论
export async function deleteComment(commentId) {
  try {
    await db.remove(`comments/${commentId}`);
    return true;
  } catch (error) {
    console.error('删除评论失败:', error);
    throw error;
  }
}
