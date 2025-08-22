// api/likes.js
import { parseBody, setCORS, validateInput, sanitizeInput } from '../lib/utils.js';
import { getLikes, addLike, removeLike, checkUserLike } from '../lib/like.js';

export default async function handler(req, res) {
  try {
    setCORS(res);

    // 处理预检请求
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { postId, userId } = req.query;

    // 验证必要参数
    if (!postId) {
      return res.status(400).json({
        success: false,
        error: 'Missing postId parameter'
      });
    }

    // 获取点赞数
    if (req.method === 'GET') {
      try {
        const likes = await getLikes(postId);
        let userLiked = false;

        // 如果提供了userId，检查用户是否已点赞
        if (userId) {
          userLiked = await checkUserLike(postId, userId);
        }

        return res.status(200).json({
          success: true,
          data: {
            postId,
            likes,
            userLiked
          }
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Failed to get likes'
        });
      }
    }

    // 添加/移除点赞
    if (req.method === 'POST' || req.method === 'DELETE') {
      try {
        const body = await parseBody(req);
        const { userId: bodyUserId } = body;

        // 验证必要字段
        validateInput(body, ['userId']);

        const sanitizedUserId = sanitizeInput(bodyUserId);

        if (req.method === 'POST') {
          await addLike(postId, sanitizedUserId);
          return res.status(200).json({
            success: true,
            message: 'Like added successfully'
          });
        } else {
          await removeLike(postId, sanitizedUserId);
          return res.status(200).json({
            success: true,
            message: 'Like removed successfully'
          });
        }
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
