// api/index.js
import { submitComment, getComments, deleteComment, editComment } from "./comments";
import { getUserByUsername, registerUser, loginUser } from "./user"; // 假设这些方法在 user.js 已定义

export default async function handler(req, res) {
  // =================== CORS ===================
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action } = req.body || req.query || {};

    // =================== 用户相关 ===================
    if (req.url.startsWith("/api/users") || action === "register" || action === "login") {
      if (req.method === "GET") {
        // 查询用户名是否存在 ?username=xxx
        const username = req.query.username;
        if (!username) return res.status(400).json({ error: "Missing username" });
        const user = await getUserByUsername(username);
        return res.json({ exists: !!user });
      }

      if (req.method === "POST") {
        if (!action) return res.status(400).json({ error: "Missing action" });

        const { username, email, password } = req.body;

        if (action === "register") {
          if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });
          const userExists = await getUserByUsername(username);
          if (userExists) return res.status(409).json({ error: "Username already exists" });
          const newUser = await registerUser({ username, email, password });
          return res.status(201).json(newUser);
        }

        if (action === "login") {
          if (!username || !password) return res.status(400).json({ error: "Missing fields" });
          const user = await loginUser({ username, password });
          if (!user) return res.status(401).json({ error: "Invalid username or password" });
          return res.json({ username: user.username, email: user.email });
        }

        return res.status(400).json({ error: "Invalid action" });
      }

      return res.status(405).json({ error: "Method not allowed" });
    }

    // =================== 评论相关 ===================
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
