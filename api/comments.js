// api/comments.js
import { getComments, addComment, deleteComment } from '../lib/comments.js';
import { setCORS, handleError } from '../lib/utils.js';

export default async function handler(req, res) {
  setCORS(res);

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    switch (req.method) {
      case 'GET':
        const comments = await getComments();
        return res.status(200).json({
          success: true,
          data: comments
        });

      case 'POST':
        const newComment = await addComment(req.body);
        return res.status(201).json({
          success: true,
          data: newComment
        });

      case 'DELETE':
        const { commentId } = req.query;
        if (!commentId) {
          return res.status(400).json({
            success: false,
            error: '缺少评论ID'
          });
        }

        await deleteComment(commentId);
        return res.status(200).json({
          success: true,
          message: '评论已删除'
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
