module.exports = async function handler(req, res) {
  res.status(200).json({
    message: "Custom Comment System API running",
    routes: ["/comments", "/likes", "/", "/index", "/users"]
  });
};
