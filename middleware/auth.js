// server/middleware/auth.js
const jwt = require("jsonwebtoken");

function auth(requiredRole = null) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      if (requiredRole && payload.role !== requiredRole) return res.status(403).json({ message: "Forbidden" });
      next();
    } catch (err) {
      return res.status(401).json({ message: "Invalid token" });
    }
  };
}

module.exports = auth;
