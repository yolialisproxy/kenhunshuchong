// api/comments.js
import { initFirebase, ref, push, set, get, update, remove, runTransaction } from './utils.js';

// 初始化Firebase
const db = initFirebase();

export default async function handler(req, res) {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { postId, commentId, content, userId } = req.body;
    const method = req.method;

    // 输入验证
    if (!postId) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数: postId'
      });
    }

    // 根据HTTP方法处理不同操作
    switch (method) {
      case 'POST':
        return await addComment(req, res);
      case 'GET':
        return await getComments(req, res);
      case 'PUT':
        return await updateComment(req, res);
      case 'DELETE':
        return await deleteComment(req, res);
      default:
        return res.status(405).json({
          success: false,
          error: '不支持的HTTP方法'
        });
    }
  } catch (error) {
    console.error('API错误:', error);
    return res.status(500).json({
      success: false,
      error: '服务器内部错误',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// 添加评论
async function addComment(req, res) {
  const { postId, content, userId } = req.body;

  if (!content || !userId) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数: content 或 userId'
    });
  }

  try {
    const commentsRef = ref(db, `comments/${postId}`);
    const newCommentRef = push(commentsRef);

    await set(newCommentRef, {
      content,
      userId,
      timestamp: Date.now(),
      likes: 0
    });

    return res.status(201).json({
      success: true,
      data: { commentId: newCommentRef.key }
    });
  } catch (error) {
    console.error('添加评论失败:', error);
    return res.status(500).json({
      success: false,
      error: '添加评论失败'
    });
  }
}

// 获取评论
async function getComments(req, res) {
  const { postId } = req.query;

  try {
    const commentsRef = ref(db, `comments/${postId}`);
    const snapshot = await get(commentsRef);

    if (snapshot.exists()) {
      const comments = [];
      snapshot.forEach(childSnapshot => {
        comments.push({
          id: childSnapshot.key,
          ...childSnapshot.val()
        });
      });

      return res.status(200).json({
        success: true,
        data: comments
      });
    } else {
      return res.status(200).json({
        success: true,
        data: []
      });
    }
  } catch (error) {
    console.error('获取评论失败:', error);
    return res.status(500).json({
      success: false,
      error: '获取评论失败'
    });
  }
}

// 更新评论
async function updateComment(req, res) {
  const { postId, commentId, content, userId } = req.body;

  if (!commentId || !content || !userId) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数: commentId, content 或 userId'
    });
  }

  try {
    const commentRef = ref(db, `comments/${postId}/${commentId}`);
    const snapshot = await get(commentRef);

    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: '评论不存在'
      });
    }

    const commentData = snapshot.val();

    // 验证用户权限
    if (commentData.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: '无权限修改此评论'
      });
    }

    await update(commentRef, {
      content,
      updatedAt: Date.now()
    });

    return res.status(200).json({
      success: true,
      message: '评论更新成功'
    });
  } catch (error) {
    console.error('更新评论失败:', error);
    return res.status(500).json({
      success: false,
      error: '更新评论失败'
    });
  }
}

// 删除评论
async function deleteComment(req, res) {
  const { postId, commentId, userId } = req.body;

  if (!commentId || !userId) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数: commentId 或 userId'
    });
  }

  try {
    const commentRef = ref(db, `comments/${postId}/${commentId}`);
    const snapshot = await get(commentRef);

    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: '评论不存在'
      });
    }

    const commentData = snapshot.val();

    // 验证用户权限
    if (commentData.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: '无权限删除此评论'
      });
    }

    await remove(commentRef);

    return res.status(200).json({
      success: true,
      message: '评论删除成功'
    });
  } catch (error) {
    console.error('删除评论失败:', error);
    return res.status(500).json({
      success: false,
      error: '删除评论失败'
    });
  }
}
