// server/models/User.js - COMPLETE MODEL WITH ALL FIELDS
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  // Basic Auth Fields
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "user"], default: "user" },

  // ✅ ONBOARDING & PROFILE FIELDS (ADD THESE!)
  onboardingCompleted: { type: Boolean, default: false },
  profilePicture: { type: String },
  fullName: { type: String },
  phoneNumber: { type: String },
  province: { type: String },
  city: { type: String },
  courtName: { type: String },
  barCouncilNumber: { type: String },

  // Subscription Fields
  isPaid: { type: Boolean, default: false },
  isSubscribed: { type: Boolean, default: false },
  subscriptionStatus: {
    type: String,
    enum: ["trial", "active", "expired", "cancelled"],
    default: "trial",
  },
  trialStartDate: { type: Date },
  trialEndDate: { type: Date },
  subscriptionStartDate: { type: Date },
  subscriptionEndDate: { type: Date },

  // Payment Fields
  paymentStatus: {
    type: String,
    enum: ["pending", "completed", "failed"],
    default: "pending",
  },
  paymentMethod: {
    type: String,
    enum: ["bank_transfer", "easypaisa", "jazzcash", "card"],
  },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Hash password before saving
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to check if trial is active
UserSchema.methods.isTrialActive = function () {
  if (!this.trialStartDate) return false;
  const now = new Date();
  return now <= this.trialEndDate;
};

// Method to check if subscription is active
UserSchema.methods.hasActiveSubscription = function () {
  if (this.role === "admin") return true;
  if (this.isTrialActive()) return true;
  if (this.isSubscribed && this.subscriptionEndDate) {
    return new Date() <= this.subscriptionEndDate;
  }
  return false;
};

const User = mongoose.models.User || mongoose.model("User", UserSchema);
module.exports = User;
