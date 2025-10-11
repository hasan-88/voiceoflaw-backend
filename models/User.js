// User.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "user"], default: "user" },
  isPaid: { type: Boolean, default: false }, // Naya field payment ke liye
  
});

const User = mongoose.models.User || mongoose.model("User", UserSchema);
module.exports = User;