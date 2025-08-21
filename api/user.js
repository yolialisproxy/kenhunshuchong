import { db, ref, set, get, parseBody, setCORS } from './utils';
import bcrypt from "bcryptjs";


// 注册（优化：添加密码强度检查可选）
export async function registerUserHandler(req, res) {

  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: "缺少用户名、邮箱或密码" });
  }

  // 优化：密码强度（最小8位，含数字/字母）
  if (password.length < 8 || !/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
    return res.status(400).json({ error: "密码太弱，至少8位含数字和字母" });
  }

  const userRef = ref(db, `users/${username}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    return res.status(409).json({ error: "用户名已存在" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await set(userRef, {
    username,
    email,
    password: hashedPassword,
    createdAt: Date.now(),
  });

  return res.status(200).json({ message: "注册成功" });
}

// 登录（无变）
export async function loginUserHandler(req, res) {

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "缺少用户名或密码" });
  }

  const userRef = ref(db, `users/${username}`);
  const snapshot = await get(userRef);

  if (!snapshot.exists()) {
    return res.status(404).json({ error: "用户不存在" });
  }

  const userData = snapshot.val();
  const match = await bcrypt.compare(password, userData.password);

  if (!match) {
    return res.status(401).json({ error: "密码错误" });
  }

  return res.status(200).json({
    message: "登录成功",
    user: { username: userData.username, email: userData.email },
  });
}

export default async function handler(req, res) {
    // ================= CORS =================
    setCORS(res);

    try {
        // ===== 用户相关 =====
        const action = req.query.action;
        if (req.method === "POST" && action === "register") {
            return await registerUserHandler(req, res);
        }
        if (req.method === "POST" && action === "login") {
            return await loginUserHandler(req, res);
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: '服务器错误', details: err.message });
    }
}
