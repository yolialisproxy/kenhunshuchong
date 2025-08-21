import { submitComment, getComments, deleteComment, editComment } from "./comments";
import { registerUserHandler, loginUserHandler } from "./user";
import likeHandler from "./like";
import { parseBody } from "./utils";

// 统一 CORS 设置
async function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Handler（优化：统一CORS和parseBody）
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  req.body = await parseBody(req);

  try {
    const action = req.query.action;

    // 用户
    if (req.method === "POST" && action === "register") {
      return await registerUserHandler(req, res);
    }
    if (req.method === "POST" && action === "login") {
      return await loginUserHandler(req, res);
    }

    // 点赞
    if (req.method === "POST" && action === "like") {
      return await likeHandler(req, res);
    }

    // 评论
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
