// server/models/Content.js
const mongoose = require("mongoose");
const ContentSchema = new mongoose.Schema({
  about: { type: String, default: "" },
  announcements: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("Content", ContentSchema);
