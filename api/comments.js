import { getDatabase, ref, get, query, orderByChild, limitToFirst, startAfter } from 'firebase/database';

// 修改 GET 请求部分，增加分页支持
export default async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    const { postId, name, email, comment } = req.body;

    // Check required fields
    if (!postId || !name || !email || !comment) {
      return res.status(400).json({
        error: 'Missing required fields: postId, name, email, or comment',
      });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      const newCommentRef = push(commentsRef);
      await set(newCommentRef, {
        name,
        email,
        comment,
        date: Date.now(),
      });

      return res.status(200).json({ message: 'Comment submitted successfully', commentId: newCommentRef.key });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Unable to submit comment',
        details: error.message,
      });
    }
  } else if (req.method === 'GET') {
    const { postId, page = 1 } = req.query;
    const pageSize = 10; // 每页显示的评论数

    if (!postId) {
      return res.status(400).json({ error: 'Missing postId parameter' });
    }

    try {
      const commentsRef = ref(db, 'comments/' + postId);
      
      // 查询条件：按时间排序，限制每页评论数
      let commentsQuery = query(
        commentsRef,
        orderByChild('date'),
        limitToFirst(pageSize),
        startAfter(page > 1 ? (page - 1) * pageSize : 0) // 计算起始点，支持分页
      );

      const snapshot = await get(commentsQuery);

      if (!snapshot.exists()) {
        return res.status(404).json({ error: 'No comments found' });
      }

      const comments = snapshot.val();
      const commentsList = Object.keys(comments).map((key) => ({
        id: key,
        ...comments[key],
      }));

      // 计算总页数
      const totalComments = Object.keys(comments).length; // 评论总数
      const totalPages = Math.ceil(totalComments / pageSize);

      return res.status(200).json({ comments: commentsList, totalPages });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: 'Unable to fetch comments',
        details: error.message,
      });
    }
  } else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}
