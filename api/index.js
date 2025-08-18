import { submitComment, getComments, deleteComment, editComment } from "./comments";

// 处理请求
export default async function handler(req, res) {
  if (req.method === "POST") {
    return submitComment(req, res);
  } else if (req.method === "GET") {
    return getComments(req, res);
  } else if (req.method === "DELETE") {
    return deleteComment(req, res);
  } else if (req.method === "PUT") {
    return editComment(req, res);
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
