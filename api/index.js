import { 
  submitComment, 
  getComments, 
  deleteComment, 
  editComment, 
  likeComment 
} from './comments';

export default async function handler(req, res) {
  // ================= CORS =================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ================= 路由分发 =================
  try {
    if (req.method === 'POST') {
      // 判断是否点赞请求
      if (req.body.action === 'like') {
        return likeComment(req, res);
      } else {
        return submitComment(req, res);
      }
    } else if (req.method === 'GET') {
      return getComments(req, res);
    } else if (req.method === 'DELETE') {
      return deleteComment(req, res);
    } else if (req.method === 'PUT') {
      return editComment(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误', details: err.message });
  }
}
