// server/routes/admin.js
const express = require("express");
const auth = require("../middleware/auth");
const User = require("../models/User");
const router = express.Router();

// get all users (admin)
router.get("/users", auth("admin"), async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

// mark a user as paid (admin)
router.put("/user/:id/mark-paid", auth("admin"), async (req, res) => {
  const { id } = req.params;
  const u = await User.findById(id);
  if (!u) return res.status(404).json({ message: "User not found" });
  u.isPaid = true;
  await u.save();
  res.json({ ok: true });
});

module.exports = router;
