import { submitComment, getComments, deleteComment, editComment } from "./comments";
import { registerUser, loginUser } from "./user";

export default async function handler(req, res) {
  // =================== CORS ===================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ========== 用户相关 ==========
    if (req.url.startsWith("/api/user")) {
      if (req.method === "POST") {
        const { action, username, password } = req.body;

        if (action === "register") {
          const result = await registerUser(username, password);
          return res.status(result.status).json(result.body);
        } else if (action === "login") {
          const result = await loginUser(username, password);
          return res.status(result.status).json(result.body);
        } else {
          return res.status(400).json({ error: "无效的用户操作" });
        }
      } else {
        return res.status(405).json({ error: "Method not allowed" });
      }
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
