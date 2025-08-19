// api/index.js
import { submitComment, getComments, deleteComment, editComment } from "./comments";
import { registerUser, loginUser } from "./user";

export default async function handler(req, res) {
  // =================== CORS ===================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // 支持 action 放在 query 或者 body 中
    const action = (req.query && req.query.action) || (req.body && req.body.action) || null;

    // ========== 用户相关 ==========
    if (action === "register" && req.method === "POST") {
      // 传入 req.body 给 user 模块（模块返回 {status, body}）
      const { username, email, password } = req.body || {};
      const result = await registerUser({ username, email, password });
      return res.status(result.status).json(result.body);
    }
    if (action === "login" && req.method === "POST") {
      const { username, password } = req.body || {};
      const result = await loginUser({ username, password });
      return res.status(result.status).json(result.body);
    }

    // ========== 评论相关 ==========
    switch (req.method) {
      case "POST":
        return await submitComment(req, res);
      case "GET":
        return await getComments(req, res);
      case "DELETE":
        return await deleteComment(req, res);
      case "PUT":
        return await editComment(req, res);
      default:
        return res.status(405).json({ error: "Method not allowed" });
    }
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
