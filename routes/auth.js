// server/routes/auth.js - COMPLETE AUTH ROUTES WITH ONBOARDING
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const User = require("../models/User");
const auth = require("../middleware/auth");

const router = express.Router();

// JWT secret (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// ============================================
// MULTER SETUP FOR PROFILE PICTURE UPLOAD
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Make sure this folder exists!
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "profile-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});

// ============================================
// REGISTER ROUTE
// ============================================
router.post("/register", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Create trial dates (7 days trial)
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const newUser = new User({
      email,
      password, // Will be hashed by pre-save hook
      role: role || "user",
      isPaid: false,
      isSubscribed: false,
      subscriptionStatus: "trial",
      trialStartDate: now,
      trialEndDate: trialEnd,

      // ✅ CRITICAL: Set onboarding to false for new users
      onboardingCompleted: false,
    });

    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, role: newUser.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser._id,
        email: newUser.email,
        role: newUser.role,
        isPaid: newUser.isPaid,
        isSubscribed: newUser.isSubscribed,
        subscriptionStatus: newUser.subscriptionStatus,
        trialEndDate: newUser.trialEndDate,

        // ✅ CRITICAL: Include this in response
        onboardingCompleted: false,
      },
      message: "Registration successful",
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// LOGIN ROUTE
// ============================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // ✅ CRITICAL: Return ALL profile fields
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        isPaid: user.isPaid,
        isSubscribed: user.isSubscribed,
        subscriptionStatus: user.subscriptionStatus,
        trialEndDate: user.trialEndDate,

        // ✅ ONBOARDING FIELDS (MUST INCLUDE!)
        onboardingCompleted: user.onboardingCompleted || false,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        province: user.province,
        city: user.city,
        courtName: user.courtName,
        barCouncilNumber: user.barCouncilNumber,
        profilePicture: user.profilePicture,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// COMPLETE PROFILE ROUTE (NEW!)
// ============================================
router.post(
  "/complete-profile",
  auth(),
  upload.single("profilePicture"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        fullName,
        phoneNumber,
        province,
        city,
        courtName,
        barCouncilNumber,
      } = req.body;

      // Validate required fields
      if (!fullName || !phoneNumber || !province || !city || !courtName) {
        return res.status(400).json({
          message: "Please fill in all required fields",
        });
      }

      // Find user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update user profile
      user.fullName = fullName;
      user.phoneNumber = phoneNumber;
      user.province = province;
      user.city = city;
      user.courtName = courtName;
      user.barCouncilNumber = barCouncilNumber || "";
      user.onboardingCompleted = true; // ✅ CRITICAL!

      // Handle profile picture if uploaded
      if (req.file) {
        user.profilePicture = `/uploads/${req.file.filename}`;
      }

      user.updatedAt = new Date();
      await user.save();

      // Return updated user (exclude password)
      const userResponse = {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        province: user.province,
        city: user.city,
        courtName: user.courtName,
        barCouncilNumber: user.barCouncilNumber,
        profilePicture: user.profilePicture,
        onboardingCompleted: user.onboardingCompleted,
        role: user.role,
        isPaid: user.isPaid,
        isSubscribed: user.isSubscribed,
        subscriptionStatus: user.subscriptionStatus,
        trialEndDate: user.trialEndDate,
        createdAt: user.createdAt,
      };

      res.json({
        message: "Profile completed successfully",
        user: userResponse,
      });
    } catch (error) {
      console.error("Complete profile error:", error);
      res.status(500).json({
        message: "Failed to complete profile",
        error: error.message,
      });
    }
  }
);

// ============================================
// GET PROFILE ROUTE (OPTIONAL BUT USEFUL)
// ============================================
router.get("/profile", auth(), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
