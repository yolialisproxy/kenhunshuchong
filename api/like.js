// api/likes.js
import { addLike, removeLike, getLikesCount } from '../lib/likes.js';
import { setCORS, handleError } from '../lib/utils.js';

export default async function handler(req, res) {
  setCORS(res);

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    switch (req.method) {
      case 'POST':
        const like = await addLike(req.body);
        return res.status(201).json({
          success: true,
          data: like
        });

      case 'DELETE':
        await removeLike(req.body);
        return res.status(200).json({
          success: true,
          message: '点赞已移除'
        });

      case 'GET':
        const { postId } = req.query;
        if (!postId) {
          return res.status(400).json({
            success: false,
            error: '缺少帖子ID'
          });
        }

        const count = await getLikesCount(postId);
        return res.status(200).json({
          success: true,
          data: { count }
        });

      default:
        return res.status(405).json({
          success: false,
          error: '方法不允许'
        });
    }
  } catch (error) {
    return handleError(error, res);
  }
}
