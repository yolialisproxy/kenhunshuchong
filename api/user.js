// api/user.js
import fs from "fs";
import path from "path";

const usersFile = path.join(process.cwd(), "data", "users.json");

// ========== 工具函数 ==========
function readUsers() {
  if (!fs.existsSync(usersFile)) return [];
  const raw = fs.readFileSync(usersFile, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

// ========== 注册 ==========
export async function registerUser(req, res) {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: "用户名、邮箱和密码不能为空" });
  }

  const users = readUsers();

  // 检查用户名是否存在
  if (users.some((u) => u.username === username)) {
    return res.status(400).json({ error: "用户名已存在" });
  }

  // 检查邮箱是否存在
  if (users.some((u) => u.email === email)) {
    return res.status(400).json({ error: "该邮箱已被注册" });
  }

  const newUser = {
    id: Date.now(),
    username,
    email,
    password, // ⚠️ 生产环境请用 bcrypt.hash 加密
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  writeUsers(users);

  return res.status(201).json({ message: "注册成功", user: { username, email } });
}

// ========== 登录 ==========
export async function loginUser(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "用户名和密码不能为空" });
  }

  const users = readUsers();

  const user = users.find((u) => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "用户名或密码错误" });
  }

  return res.status(200).json({
    message: "登录成功",
    user: { username: user.username, email: user.email },
  });
}
