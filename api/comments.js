export default async function handler(req, res) {
  if (req.method === "GET") {
    // 测试返回
    res.status(200).json({ comments: [{ id: 1, name: "测试", comment: "Hello World", date: Date.now() }] });
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
