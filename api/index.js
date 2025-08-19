// api/index.js
import { submitComment, getComments, deleteComment, editComment } from "./comments";

export default async function handler(req, res) {
  // =================== CORS ===================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    switch (req.method) {
      case 'POST':
        // 支持点赞和提交评论
        return await submitComment(req, res);
      case 'GET':
        return await getComments(req, res);
      case 'DELETE':
        return await deleteComment(req, res);
      case 'PUT':
        return await editComment(req, res);
      default:
        return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
