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
    const { action } = req.query;

    // ========== 用户相关 ==========
    if (action === "register" && req.method === "POST") {
      return await registerUser(req, res);
    }
    if (action === "login" && req.method === "POST") {
      return await loginUser(req, res);
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
