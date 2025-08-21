import { submitComment, getComments, deleteComment, editComment } from "./comments";
import { registerUserHandler, loginUserHandler } from "./user";
import likeHandler from "./like"; // ✅ 新增

// ================== 智能 body 解析器 ==================
async function parseBody(req) {
  let body = req.body;

  // 已经是对象直接返回
  if (body && typeof body === "object") return body;

  try {
    // JSON 格式
    if (req.headers["content-type"]?.includes("application/json")) {
      return typeof body === "string" ? JSON.parse(body) : body;
    }

    // 尝试 JSON.parse
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        // 尝试解析 querystring 格式
        return Object.fromEntries(new URLSearchParams(body));
      }
    }

    // fallback
    return {};
  } catch (e) {
    console.warn("⚠️ Body 解析失败，已用空对象兜底:", e);
    return {};
  }
}

export default async function handler(req, res) {
  // =================== CORS ===================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // 统一解析 body
  req.body = await parseBody(req);

  try {
    const action = req.query.action;

    // ===== 用户相关 =====
    if (req.method === "POST" && action === "register") {
      return await registerUserHandler(req, res);
    }
    if (req.method === "POST" && action === "login") {
      return await loginUserHandler(req, res);
    }

    // ===== 点赞相关 =====
    if (req.method === "POST" && action === "like") {
      return await likeHandler(req, res);
    }

    // ===== 评论相关 =====
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
    return res.status(500).json({ error: "服务器错误", details: err.message });
  }
}
