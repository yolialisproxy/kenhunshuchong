import { submitComment, getComments, deleteComment, editComment } from "./comments";
import { registerUserHandler, loginUserHandler } from "./user";
import likeHandler from "./like";
import { parseBody, setCORS } from "./utils";

export default async function handler(req, res) {
  setCORS(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    req.body = await parseBody(req);
    const action = req.query.action;

    if (req.method === "POST" && action === "register") {
      return await registerUserHandler(req, res);
    }
    if (req.method === "POST" && action === "login") {
      return await loginUserHandler(req, res);
    }

    if (req.method === "POST" && action === "like") {
      return await likeHandler(req, res);
    }

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
    console.error("❌ API handler错误:", err);
    return res.status(500).json({ error: "服务器错误", details: err.message });
  }
}
