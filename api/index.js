import { submitComment, getComments, deleteComment, editComment, likeComment } from "./comments"; // 注意引入 likeComment

export default async function handler(req, res) {
  // POST 同时处理主评论和点赞区分
  if (req.method === "POST") {
    // 如果请求 body 有 commentId 且没有 name/email/comment，则视为点赞
    if (req.body.commentId && !req.body.comment) {
      return likeComment(req, res);
    } else {
      return submitComment(req, res);
    }
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
