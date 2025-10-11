// server/routes/content.js
const express = require("express");
const Content = require("../models/Content");
const auth = require("../middleware/auth");
const router = express.Router();

router.get("/", async (req, res) => {
  try {
    let doc = await Content.findOne();
    if (!doc) doc = await Content.create({});
    res.json({ about: doc.about, announcements: doc.announcements });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT -> admin only
router.put("/", auth("admin"), async (req, res) => {
  try {
    const { about = "", announcements = "" } = req.body || {};
    let doc = await Content.findOne();
    if (!doc) doc = await Content.create({ about, announcements });
    else { doc.about = about; doc.announcements = announcements; await doc.save(); }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
