// api/comments.js
import { parseBody, setCORS, validateInput, sanitizeInput, ref, push, set, get, database } from '../lib/utils.js';

export default async function handler(req, res) {
  try {
    setCORS(res);

    // 处理预检请求
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { postId } = req.query;

    // 验证必要参数
    if (!postId) {
      return res.status(400).json({
        success: false,
        error: 'Missing postId parameter'
      });
    }

    // 获取评论
    if (req.method === 'GET') {
      try {
        const commentsRef = ref(database, `comments/${postId}`);
        const snapshot = await get(commentsRef);

        let comments = [];
        if (snapshot.exists()) {
          const data = snapshot.val();
          comments = Object.keys(data).map(key => ({
            id: key,
            ...data[key]
          }));
        }

        return res.status(200).json({
          success: true,
          data: {
            postId,
            comments
          }
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Failed to get comments'
        });
      }
    }

    // 添加评论
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req);

        // 验证必要字段
        validateInput(body, ['userId', 'content']);

        const { userId, content, parentCommentId } = body;
        const sanitizedContent = sanitizeInput(content);

        const newCommentRef = push(ref(database, `comments/${postId}`));
        await set(newCommentRef, {
          userId: sanitizeInput(userId),
          content: sanitizedContent,
          parentCommentId: parentCommentId || null,
          timestamp: Date.now(),
          likes: 0
        });

        return res.status(201).json({
          success: true,
          message: 'Comment added successfully',
          data: {
            commentId: newCommentRef.key
          }
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message || 'Invalid request'
        });
      }
    }

    // 不支持的方法
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
}
