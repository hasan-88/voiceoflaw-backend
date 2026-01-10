// index.js - Combined Backend Server with Enhanced Subscription System
const express = require("express");
const axios = require("axios");
require("dotenv").config();
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const STRIPE_SECRET = process.env.STRIPE_SECRET;

const stripe = Stripe(STRIPE_SECRET);

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/voiceoflaw")
  .then(() => console.log("Connected to MongoDB 🚀"))
  .catch((err) => console.error("Could not connect to MongoDB:", err));

// ============================================
// ENHANCED USER SCHEMA WITH SUBSCRIPTION
// ============================================
const UserSchema = new mongoose.Schema({
  name: { type: String },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "user"], default: "user" },

  // ✅ ADD THESE NEW PROFILE FIELDS
  onboardingCompleted: { type: Boolean, default: false },
  profilePicture: { type: String },
  fullName: { type: String },
  phoneNumber: { type: String },
  province: { type: String },
  city: { type: String },
  courtName: { type: String },
  barCouncilNumber: { type: String },

  // Enhanced Subscription Fields
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

  // ✅ NEW: Daily Limits for Free Trial Users
  dailyLimits: {
    casesCreatedToday: { type: Number, default: 0 },
    notesCreatedToday: { type: Number, default: 0 },
    booksDownloadedToday: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now },
  },

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

  // Reminder tracking
  remindersSent: { type: Number, default: 0 },
  lastReminderDate: { type: Date },

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

// ✅ Method to check if trial is active
UserSchema.methods.isTrialActive = function () {
  if (!this.trialStartDate) return false;
  const now = new Date();
  return now <= this.trialEndDate;
};

// ✅ Method to check if subscription is active
UserSchema.methods.hasActiveSubscription = function () {
  if (this.role === "admin") return true;

  // Check trial first
  if (this.isTrialActive()) return true;

  // Check paid subscription
  if (this.isSubscribed && this.subscriptionEndDate) {
    return new Date() <= this.subscriptionEndDate;
  }

  return false;
};

// ✅ NEW: Method to reset daily limits if needed
UserSchema.methods.resetDailyLimitsIfNeeded = function () {
  const now = new Date();
  const lastReset = this.dailyLimits.lastResetDate;

  // Check if it's a new day
  if (
    !lastReset ||
    now.getDate() !== lastReset.getDate() ||
    now.getMonth() !== lastReset.getMonth() ||
    now.getFullYear() !== lastReset.getFullYear()
  ) {
    this.dailyLimits = {
      casesCreatedToday: 0,
      notesCreatedToday: 0,
      booksDownloadedToday: 0,
      lastResetDate: now,
    };
    return true;
  }
  return false;
};

// ✅ NEW: Check if user can create case (5 per day for trial)
UserSchema.methods.canCreateCase = function () {
  if (this.role === "admin") return true;
  if (this.isSubscribed) return true; // Unlimited for paid users

  // For trial users: max 2 per day
  if (this.isTrialActive()) {
    this.resetDailyLimitsIfNeeded();
    return this.dailyLimits.casesCreatedToday < 2;
  }

  return false;
};

// ✅ NEW: Check if user can create note (2 per day for trial)
UserSchema.methods.canCreateNote = function () {
  if (this.role === "admin") return true;
  if (this.isSubscribed) return true; // Unlimited for paid users

  // For trial users: max 2 per day
  if (this.isTrialActive()) {
    this.resetDailyLimitsIfNeeded();
    return this.dailyLimits.notesCreatedToday < 2;
  }

  return false;
};

// ✅ NEW: Check if user can download book (2 per day for trial)
UserSchema.methods.canDownloadBook = function () {
  if (this.role === "admin") return true;
  if (this.isSubscribed) return true; // Unlimited for paid users

  // For trial users: max 2 per day
  if (this.isTrialActive()) {
    this.resetDailyLimitsIfNeeded();
    return this.dailyLimits.booksDownloadedToday < 2;
  }

  return false;
};

// ✅ NEW: Increment case creation count
UserSchema.methods.incrementCaseCount = async function () {
  this.resetDailyLimitsIfNeeded();
  this.dailyLimits.casesCreatedToday += 1;
  await this.save();
};

// ✅ NEW: Increment note creation count
UserSchema.methods.incrementNoteCount = async function () {
  this.resetDailyLimitsIfNeeded();
  this.dailyLimits.notesCreatedToday += 1;
  await this.save();
};

// ✅ NEW: Increment book download count
UserSchema.methods.incrementBookDownloadCount = async function () {
  this.resetDailyLimitsIfNeeded();
  this.dailyLimits.booksDownloadedToday += 1;
  await this.save();
};

// ============================================
// PAYMENT TRANSACTION SCHEMA
// ============================================
const PaymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: "PKR" },
  paymentMethod: {
    type: String,
    enum: ["bank_transfer", "easypaisa", "jazzcash", "card"],
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "completed", "failed", "verified"],
    default: "pending",
  },
  transactionId: { type: String },
  accountNumber: { type: String }, // For mobile wallets
  senderName: { type: String },
  receiptUrl: { type: String },
  stripePaymentIntentId: { type: String },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  verifiedAt: { type: Date },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// --- Enhanced Mongoose Schemas ---

// Post Schema (Blog Content)
const PostSchema = new mongoose.Schema({
  title: String,
  description: String,
  fullContent: String,
  image: String,
  date: String,
  type: String,
  category: String,
});

// File Schema (File Management)
const FileSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  filename: { type: String, required: true },
  path: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  uploadedAt: { type: Date, default: Date.now },
});

// Note Schema (Notes Management)
const NoteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: "" },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Enhanced Case Management Schema
const CaseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    caseNo: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "hearing"],
      default: "pending",
    },
    court: {
      type: String,
      required: true,
    },
    nextHearing: {
      type: Date,
      required: true,
    },
    partyName: {
      type: String,
      required: true,
    },
    respondent: {
      type: String,
      required: true,
    },
    lawyer: {
      type: String,
      required: true,
    },
    contactNumber: {
      type: String,
      required: true,
    },
    advocateContactNumber: {
      type: String,
    },
    adversePartyAdvocateName: {
      type: String,
    },
    caseYear: {
      type: Number,
      required: true,
    },
    onBehalfOf: {
      type: String,
      required: true,
      enum: [
        "Petitioner",
        "Respondent",
        "Complainant",
        "Accused",
        "Plantiff",
        "DHR",
        "JDR",
        "Appellant",
      ],
    },
    description: {
      type: String,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },

    // File attachments for different sections (Enhanced)
    drafts: [
      {
        type: { type: String, enum: ["file", "note"], required: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
        noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note" },
        name: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],

    opponentDrafts: [
      {
        type: { type: String, enum: ["file", "note"], required: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
        noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note" },
        name: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],

    courtOrders: [
      {
        type: { type: String, enum: ["file", "note"], required: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
        noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note" },
        name: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],

    evidence: [
      {
        type: { type: String, enum: ["file", "note"], required: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
        noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note" },
        name: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],

    relevantSections: [
      {
        type: { type: String, enum: ["file", "note"], required: true },
        fileId: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
        noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note" },
        name: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// index.js
// index.js (FIXED CODE)

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Ise hata dein

// index.js (Line 219)
// index.js (Constructor)
const genAI = new GoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  // CRITICAL FIX: Base URL ko naye 'v1' stable API par set karein.
  baseUrl: "https://generativelanguage.googleapis.com/v1",
});
// Conversation Schema
const ConversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  title: {
    type: String,
    default: "New Conversation",
  },
  messages: [
    {
      role: { type: String, enum: ["user", "assistant"], required: true },
      content: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      sources: [{ type: String }],
    },
  ],
  isBookmarked: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Conversation = mongoose.model("Conversation", ConversationSchema);

// Language Detection

// Language Detection
function detectLanguage(text) {
  const urduPattern = /[\u0600-\u06FF]/;
  if (urduPattern.test(text)) return "urdu";

  const romanUrduKeywords = [
    "kya",
    "hai",
    "aur",
    "ko",
    "ka",
    "ki",
    "main",
    "mein",
    "hoon",
    "kaise",
    "kyun",
    "kab",
    "kahan",
  ];
  const lowerText = text.toLowerCase();
  const romanUrduCount = romanUrduKeywords.filter((keyword) =>
    lowerText.includes(keyword)
  ).length;

  if (romanUrduCount >= 2) return "roman_urdu";
  return "english";
}

// Check if query is law-related
// Check if query is law-related
function isLawRelated(text) {
  const lowerText = text.toLowerCase();

  // Allow greetings
  const greetings = [
    "hi",
    "hello",
    "hey",
    "salam",
    "assalam",
    "good morning",
    "good evening",
    "kya hal",
    "kaisay",
    "kaise ho",
    "how are you",
    "thanks",
    "thank you",
    "shukriya",
  ];
  const isGreeting =
    greetings.some((g) => lowerText.includes(g)) && text.length < 50;

  if (isGreeting) return true;

  const legalKeywords = [
    "law",
    "legal",
    "court",
    "judge",
    "magistrate",
    "case",
    "attorney",
    "lawyer",
    "advocate",
    "barrister",
    "solicitor",
    "counsel",
    "constitution",
    "act",
    "section",
    "article",
    "petition",
    "appeal",
    "defendant",
    "plaintiff",
    "petitioner",
    "respondent",
    "prosecution",
    "defense",
    "defence",
    "bail",
    "custody",
    "remand",
    "verdict",
    "judgment",
    "order",
    "decree",
    "statute",
    "regulation",
    "ordinance",
    "rule",
    "contract",
    "agreement",
    "deed",
    "lease",
    "property",
    "land",
    "estate",
    "title",
    "mortgage",
    "rent",
    "tenant",
    "landlord",
    "eviction",
    "possession",
    "ownership",
    "inheritance",
    "will",
    "testament",
    "heir",
    "succession",
    "probate",
    "criminal",
    "crime",
    "murder",
    "theft",
    "robbery",
    "burglary",
    "assault",
    "fraud",
    "corruption",
    "bribery",
    "embezzlement",
    "forgery",
    "kidnapping",
    "rape",
    "fir",
    "challan",
    "investigation",
    "police",
    "arrest",
    "warrant",
    "summons",
    "civil",
    "family",
    "divorce",
    "talaq",
    "khula",
    "marriage",
    "nikah",
    "custody",
    "maintenance",
    "alimony",
    "dowry",
    "mehr",
    "adoption",
    "guardianship",
    "corporate",
    "company",
    "business",
    "partnership",
    "employment",
    "labor",
    "labour",
    "termination",
    "wrongful",
    "discrimination",
    "harassment",
    "wage",
    "salary",
    "rights",
    "duty",
    "obligation",
    "liability",
    "damages",
    "compensation",
    "lawsuit",
    "litigation",
    "suit",
    "trial",
    "hearing",
    "tribunal",
    "forum",
    "justice",
    "jurisdiction",
    "precedent",
    "ruling",
    "injunction",
    "stay",
    "writ",
    "habeas corpus",
    "mandamus",
    "certiorari",
    "quo warranto",
    "evidence",
    "witness",
    "testimony",
    "affidavit",
    "statement",
    "deposition",
    "notary",
    "attestation",
    "registry",
    "registration",
    "intellectual property",
    "patent",
    "trademark",
    "copyright",
    "license",
    "tax",
    "taxation",
    "fine",
    "penalty",
    "revenue",
    "customs",
    "duty",
    "supreme court",
    "high court",
    "session court",
    "civil court",
    "ppc",
    "pakistan penal code",
    "cpc",
    "qanoon",
    "niazi",
    "qanoon",
    "qanuni",
    "adalat",
    "adlia",
    "insaf",
    "munsif",
    "judge",
    "wakeel",
    "wakeelat",
    "muqadma",
    "mukadma",
    "fauj-dari",
    "faujdari",
    "diwani",
    "deewani",
    "shadi",
    "shaadi",
    "talaq",
    "talaaq",
    "khula",
    "tarka",
    "jaidad",
    "jaaydaad",
    "milkiyat",
    "huqooq",
    "haqooq",
    "haq",
    "farz",
    "faraiz",
    "zimmedari",
    "zimmadari",
    "ilzam",
    "muddai",
    "mudda aleh",
    "tahqeeqat",
    "gawah",
    "gawaah",
    "saboot",
    "sabot",
    "faisla",
    "faisala",
    "apeel",
    "appeal",
    "darkhwast",
    "darkhast",
    "notice",
    "notic",
    "ijazat",
    "ijazah",
    "pabandi",
    "mukhalif",
    "mukhaalif",
    "mazloom",
    "kirayadar",
    "kiraya",
    "maalik",
    "malik",
    "beraasti",
    "besaasti",
    "rozgaar",
    "rozgar",
    "naukri",
    "mulazim",
    "mulazmat",
  ];

  const hasLegalKeyword = legalKeywords.some((keyword) =>
    lowerText.includes(keyword)
  );

  const legalPatterns = [
    /what.*law/i,
    /how.*legal/i,
    /can i.*sue/i,
    /my.*case/i,
    /legal.*advice/i,
    /court.*procedure/i,
    /file.*case/i,
    /lawyer.*help/i,
    /qanoon.*kya/i,
    /adalat.*mein/i,
  ];

  const matchesPattern = legalPatterns.some((pattern) => pattern.test(text));

  return hasLegalKeyword || matchesPattern;
}

// Extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = await fs.promises.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error("PDF extraction error:", error);
    return "";
  }
}

// Search in database (cases, books, documents)
async function searchInDatabase(query, userId) {
  try {
    const results = [];

    // Search in user's cases
    const cases = await Case.find({
      userId: userId,
      $or: [
        { title: { $regex: query, $options: "i" } },
        { description: { $regex: query, $options: "i" } },
        { type: { $regex: query, $options: "i" } },
      ],
    }).limit(5);

    for (const caseItem of cases) {
      results.push({
        type: "case",
        title: caseItem.title,
        content: `Case No: ${caseItem.caseNo}, Type: ${
          caseItem.type
        }, Status: ${caseItem.status}, Description: ${
          caseItem.description || "N/A"
        }`,
        source: `Case: ${caseItem.title}`,
      });
    }

    // Search in books
    const books = await Book.find({
      isActive: true,
      $or: [
        { title: { $regex: query, $options: "i" } },
        { description: { $regex: query, $options: "i" } },
        { category: { $regex: query, $options: "i" } },
      ],
    }).limit(3);

    for (const book of books) {
      // Try to extract text from PDF
      const pdfPath = path.join(__dirname, book.pdfFile);
      let pdfText = "";
      try {
        if (
          await fs.promises
            .access(pdfPath)
            .then(() => true)
            .catch(() => false)
        ) {
          pdfText = await extractTextFromPDF(pdfPath);
        }
      } catch (err) {
        console.log("Could not read PDF:", book.title);
      }

      results.push({
        type: "book",
        title: book.title,
        content: `${book.description}\n\n${pdfText.substring(0, 2000)}`,
        source: `Book: ${book.title} (${book.category})`,
      });
    }

    // Search in blog posts
    const posts = await Post.find({
      $or: [
        { title: { $regex: query, $options: "i" } },
        { description: { $regex: query, $options: "i" } },
        { fullContent: { $regex: query, $options: "i" } },
      ],
    }).limit(3);

    for (const post of posts) {
      results.push({
        type: "article",
        title: post.title,
        content: post.fullContent || post.description,
        source: `Article: ${post.title}`,
      });
    }

    return results;
  } catch (error) {
    console.error("Database search error:", error);
    return [];
  }
}

// Generate AI response using Gemini

// Generate AI response using Gemini
async function generateAIResponse(
  query,
  language,
  context,
  isLawQuery,
  conversationHistory = []
) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-pro",
      generationConfig: {
        temperature: 0.9,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    });

    let conversationContext = "";
    if (conversationHistory.length > 0) {
      conversationContext = "\n\n**Previous Conversation:**\n";
      conversationHistory.slice(-6).forEach((msg) => {
        conversationContext += `${
          msg.role === "user" ? "User" : "Assistant"
        }: ${msg.content}\n`;
      });
    }

    let systemPrompt = "";

    if (language === "urdu") {
      systemPrompt = `آپ ایک دوستانہ اور ذہین پاکستانی قانونی AI اسسٹنٹ ہیں جس کا نام "Voice of Law AI" ہے۔

**آپ کی شخصیت:**
- آپ ایک حقیقی انسان کی طرح بات کرتے ہیں، روبوٹ کی طرح نہیں
- آپ دوستانہ، مددگار، اور قابل رسائی ہیں
- آپ پیچیدہ قانونی باتوں کو آسان بناتے ہیں
- آپ صبر سے سنتے ہیں اور واضح جوابات دیتے ہیں

**آپ کیا کر سکتے ہیں:**
✓ قانونی سوالات کے جوابات (پاکستانی قانون)
✓ کیسز کی تفصیلات سمجھانا
✓ قانونی مشورہ اور رہنمائی
✓ دستاویزات کی وضاحت
✓ عام گفتگو اور سلام و کلام (دوستانہ انداز میں)

**اہم:**
- اگر کوئی آپ کو سلام کرے، دوستانہ انداز میں جواب دیں
- عام گفتگو میں حصہ لیں لیکن یاد دلائیں کہ آپ قانونی معاملات میں بہترین ہیں
- اگر سوال قانون سے بالکل متعلق نہیں، شائستگی سے بتائیں
- ہمیشہ مددگار اور محبت بھرا رویہ رکھیں`;
    } else if (language === "roman_urdu") {
      systemPrompt = `Aap ek dostana aur zaheen Pakistani legal AI assistant hain jiska naam "Voice of Law AI" hai.

**Aapki shakhsiyat:**
- Aap ek haqeeqi insaan ki tarah baat karte hain, robot ki tarah nahi
- Aap dostana, madadgar, aur qaabil-e-rasaai hain
- Aap paicheeda legal baatein aasan banate hain
- Aap sabar se sunte hain aur wazeh jawabat dete hain

**Aap kya kar sakte hain:**
✓ Legal sawalat ke jawabat (Pakistani law)
✓ Cases ki tafseelat samajhana
✓ Legal mashwara aur rahnumai
✓ Dastawezat ki wazahat
✓ Aam guftagu aur salaam o kalaam (dostana andaz mein)

**Ahem:**
- Agar koi aapko salaam kare, dostana andaz mein jawab dein
- Aam guftagu mein hissa lein lekin yaad dilayein ke aap legal matters mein behtareen hain
- Agar sawal law se bilkul related nahi, shayasta tareeqe se batayein
- Hamesha madadgar aur muthabbat rahein`;
    } else {
      systemPrompt = `You are "Voice of Law AI" - a friendly, intelligent Pakistani Legal AI Assistant with a warm personality.

**Your Personality:**
- You communicate like a real person, not a robot
- You're friendly, helpful, empathetic, and approachable
- You simplify complex legal concepts into everyday language
- You're patient, understanding, and genuinely want to help
- You have a conversational style - natural, warm, and engaging

**What You Can Do:**
✓ Answer legal questions (Pakistani law expertise)
✓ Explain cases and legal procedures
✓ Provide legal guidance and advice
✓ Review and explain legal documents
✓ Discuss legal rights and obligations
✓ Engage in casual conversation and greetings
✓ Help users understand their legal situations

**How You Respond:**
- If someone greets you (hi, hello, salam), respond warmly and ask how you can help
- For casual questions, engage naturally but gently guide toward legal topics
- For legal questions, provide detailed, practical answers
- Use examples and analogies to clarify complex points
- Show empathy when users share legal problems
- Be conversational - use "I", "you", "we" naturally
- If unsure, be honest and suggest alternatives

**When Handling Non-Legal Topics:**
- Politely acknowledge the question
- Mention that you're specialized in legal matters
- Suggest how you can help with legal questions instead
- Stay friendly and encouraging

**Your Communication Style:**
💬 Natural: "I'd be happy to help you with that!"
💬 Empathetic: "I understand this situation can be stressful..."
💬 Clear: Break down complex terms simply
💬 Helpful: Offer follow-up suggestions
💬 Professional yet friendly: Balance expertise with warmth`;
    }

    const greetings = [
      "hi",
      "hello",
      "hey",
      "salam",
      "assalam",
      "good morning",
      "good evening",
      "kya hal",
      "kaisay",
      "kaise ho",
      "how are you",
    ];
    const isGreeting =
      greetings.some((g) => query.toLowerCase().includes(g)) &&
      query.length < 50;

    let contextText = "";
    const sources = [];

    if (context && context.length > 0) {
      if (language === "urdu") {
        contextText = "\n\n📚 **آپ کے ڈیٹا بیس سے ملی معلومات:**\n";
      } else if (language === "roman_urdu") {
        contextText = "\n\n📚 **Aapke database se mili maloomat:**\n";
      } else {
        contextText = "\n\n📚 **Information Found in Your Database:**\n";
      }

      context.forEach((item, index) => {
        contextText += `\n[Source ${index + 1}] ${
          item.title
        }\n${item.content.substring(0, 1500)}...\n\n`;
        sources.push(item.source);
      });
    }

    let responseGuidance = "";

    if (isGreeting) {
      if (language === "urdu") {
        responseGuidance = `\n**ہدایت:** یہ ایک سلام ہے۔ دوستانہ انداز میں جواب دیں اور پوچھیں کہ آپ کس طرح مدد کر سکتے ہیں۔`;
      } else if (language === "roman_urdu") {
        responseGuidance = `\n**Hidayat:** Yeh ek salaam hai. Dostana andaz mein jawab dein aur pochain ke aap kis tarah madad kar sakte hain.`;
      } else {
        responseGuidance = `\n**Guidance:** This is a greeting. Respond warmly and naturally, ask how you can help.`;
      }
    } else if (!isLawQuery) {
      if (language === "urdu") {
        responseGuidance = `\n**ہدایت:** یہ سوال قانون سے متعلق نہیں ہے۔ شائستگی سے بتائیں کہ آپ قانونی معاملات میں خصوصی طور پر مدد کرتے ہیں۔`;
      } else if (language === "roman_urdu") {
        responseGuidance = `\n**Hidayat:** Yeh sawal law se related nahi hai. Shayasta tareeqe se batayein ke aap legal matters mein madad karte hain.`;
      } else {
        responseGuidance = `\n**Guidance:** This is not a legal question. Politely explain that you specialize in legal matters but stay friendly.`;
      }
    } else {
      if (language === "urdu") {
        responseGuidance = `\n**ہدایت:** قانونی سوال ہے۔ تفصیلی جواب دیں۔`;
      } else if (language === "roman_urdu") {
        responseGuidance = `\n**Hidayat:** Legal sawal hai. Tafsili jawab dein.`;
      } else {
        responseGuidance = `\n**Guidance:** Legal question. Provide detailed, helpful answer.`;
      }
    }

    const finalPrompt = `${systemPrompt}

${conversationContext}

${contextText}

**Current User Message:** ${query}

${responseGuidance}

**Important:** Respond naturally and conversationally. Be warm, professional, and genuinely helpful.

Now respond:`;

    let response = "";
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        const result = await model.generateContent(finalPrompt);
        response = result.response.text();
        break;
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return { response, sources };
  } catch (error) {
    // This will print the full error to your backend terminal
    console.error("!!!!!!!!!! REAL AI ERROR !!!!!!!!!", error);

    // This will send the error message to your chatbot UI
    return {
      response: `Error from Gemini: ${error.message}`,
      sources: [],
    };
  }
}

function getRelativeTime(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return `${Math.floor(seconds / 604800)} weeks ago`;
}

// Helper function for relative time

module.exports = { Conversation };

// New Schemas for Additional Features
const MoreAboutCardSchema = new mongoose.Schema({
  category: { type: String, required: true },
  image: { type: String, required: true },
  date: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  isLocked: { type: Boolean, default: false },
});

const LatestUpdateSchema = new mongoose.Schema({
  title: { type: String, required: true },
  summary: { type: String, required: true },
  details: { type: String, required: true },
  date: { type: String, required: true },
  type: { type: String, required: true },
  image: { type: String, required: true },
  gradient: {
    type: String,
    default: "linear-gradient(135deg, #454444 0%, #c79f44 100%)",
  },
});

const AnnouncementSchema = new mongoose.Schema({
  date: { type: String, required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  link: { type: String, default: "#" },
  category: { type: String, required: true },
  priority: {
    type: String,
    enum: ["high", "medium", "low"],
    default: "medium",
  },
});

// ==================== BOOK SCHEMA ====================
const BookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Books",
        "Case Laws / Judgements",
        "Acts & Rules",
        "Research Papers / Articles",
      ],
    },
    image: {
      type: String,
      required: true,
    },
    pdfFile: {
      type: String,
      required: true,
    },
    author: {
      type: String,
      default: "",
    },
    publishedDate: {
      type: Date,
      default: Date.now,
    },
    fileSize: {
      type: String,
      default: "",
    },
    downloads: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ==================== STANDALONE NOTE SCHEMA ====================
const StandaloneNoteSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    // NEW: Link to user who created the note
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add Article Schema after other schemas (around line 250)
const ArticleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    content: { type: String, required: true },
    introduction: { type: String },
    image: { type: String },
    url: { type: String }, // For external articles
    source: { type: String, default: "Voice of Law Review" },
    author: { type: String, default: "Legal Team" },
    category: {
      type: String,
      default: "General Legal",
      enum: [
        "General Legal",
        "Criminal Law",
        "Civil Law",
        "Tax Law",
        "Family Law",
        "Corporate Law",
        "Constitutional Law",
      ],
    },
    publishedAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    views: { type: Number, default: 0 },
    isExternal: { type: Boolean, default: false },
    externalId: { type: String }, // For NewsAPI articles
  },
  {
    timestamps: true,
  }
);

// Mongoose Models
const User = mongoose.model("User", UserSchema);
const Payment = mongoose.model("Payment", PaymentSchema);
const Post = mongoose.model("Post", PostSchema);
const Case = mongoose.model("Case", CaseSchema);
const File = mongoose.model("File", FileSchema);
const Note = mongoose.model("Note", NoteSchema);
const Article = mongoose.model("Article", ArticleSchema);
const MoreAboutCard = mongoose.model("MoreAboutCard", MoreAboutCardSchema);
const LatestUpdate = mongoose.model("LatestUpdate", LatestUpdateSchema);
const Announcement = mongoose.model("Announcement", AnnouncementSchema);
const Book = mongoose.model("Book", BookSchema);
const StandaloneNote = mongoose.model("StandaloneNote", StandaloneNoteSchema);

// Create uploads directories
const createUploadsDir = () => {
  const dirs = [
    "uploads/cases",
    "uploads/drafts",
    "uploads/evidence",
    "uploads/court-orders",
    "uploads/more-about-cards",
    "uploads/latest-updates",
    "uploads/books",
    "uploads/book-images",
    "uploads/profiles", // ✅ ADD THIS LINE
  ];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};
createUploadsDir();

// ============================================
// MIDDLEWARE - AUTH & SUBSCRIPTION CHECK
// ============================================

// Authentication Middleware (Enhanced)
const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      userId: decoded.userId || decoded.user.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (err) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

// Check Subscription Status (Enhanced)
const checkSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Admin always has access
    if (user.role === "admin") {
      req.userSubscription = { hasAccess: true, isAdmin: true };
      return next();
    }

    // Check if user has active subscription
    const hasAccess = user.hasActiveSubscription();

    if (!hasAccess) {
      return res.status(403).json({
        message: "Subscription required",
        subscriptionStatus: "expired",
        trialExpired: !user.isTrialActive(),
        requiresPayment: true,
      });
    }

    req.userSubscription = {
      hasAccess: true,
      isTrialActive: user.isTrialActive(),
      subscriptionEndDate: user.subscriptionEndDate,
      trialEndDate: user.trialEndDate,
    };

    next();
  } catch (error) {
    console.error("Subscription check error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// --- Middleware ---
app.use(
  cors({
    origin: [
      "https://voice-of-law.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
  })
);

// Add OPTIONS handler for preflight requests
app.options("*", cors());

// Webhook endpoint (must be raw body, so yeh express.json() se pehle aata hai)
app.post(
  "/api/pay/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata.userId;

      try {
        if (userId) {
          const user = await User.findById(userId);
          if (user) {
            user.isPaid = true;
            user.isSubscribed = true;
            user.subscriptionStatus = "active";
            user.paymentStatus = "completed";
            user.subscriptionStartDate = new Date();

            // Add 30 days to subscription
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            user.subscriptionEndDate = endDate;

            await user.save();
            console.log(`User ${userId} marked as paid and subscribed.`);
          }
        }
      } catch (error) {
        console.error("Error updating user payment status:", error);
        return res
          .status(500)
          .json({ message: "Server error updating payment status." });
      }
    }

    res.json({ received: true });
  }
);

// Webhook for Stripe (New endpoint for subscription payments)
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;

      // Find payment and activate subscription
      const payment = await Payment.findOne({
        stripePaymentIntentId: paymentIntent.id,
      });

      if (payment) {
        payment.status = "completed";
        await payment.save();

        const user = await User.findById(payment.userId);
        user.isSubscribed = true;
        user.subscriptionStatus = "active";
        user.subscriptionStartDate = new Date();

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        user.subscriptionEndDate = endDate;

        user.paymentStatus = "completed";
        user.isPaid = true;
        await user.save();
      }
    }

    res.json({ received: true });
  }
);

// Regular JSON middleware for other routes
app.use(express.json());

// NEW, MORE EXPLICIT STATIC ROUTES
const uploadsDir = path.join(__dirname, "uploads");
app.use(
  "/uploads/more-about-cards",
  express.static(path.join(uploadsDir, "more-about-cards"))
);
app.use(
  "/uploads/latest-updates",
  express.static(path.join(uploadsDir, "latest-updates"))
);
app.use("/uploads/drafts", express.static(path.join(uploadsDir, "drafts")));
app.use("/uploads/evidence", express.static(path.join(uploadsDir, "evidence")));
app.use(
  "/uploads/court-orders",
  express.static(path.join(uploadsDir, "court-orders"))
);
app.use("/uploads/cases", express.static(path.join(uploadsDir, "cases")));
app.use("/uploads/books", express.static(path.join(uploadsDir, "books")));
app.use(
  "/uploads/book-images",
  express.static(path.join(uploadsDir, "book-images"))
);
app.use(
  "/uploads/profiles",
  express.static(path.join(__dirname, "uploads", "profiles"))
);

app.get("/test-uploads", (req, res) => {
  const uploadsPath = path.join(__dirname, "uploads");
  res.json({
    uploadsPath: uploadsPath,
    exists: fs.existsSync(uploadsPath),
    files: fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath) : [],
  });
});

// ==================== API ENDPOINTS ====================

// Get all conversations for user
app.get("/api/chatbot/conversations", authMiddleware, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.userId })
      .sort({ updatedAt: -1 })
      .select("title messages isBookmarked createdAt updatedAt");

    const formatted = conversations.map((conv) => ({
      id: conv._id,
      title: conv.title,
      preview:
        conv.messages.length > 0
          ? conv.messages[conv.messages.length - 1].content.substring(0, 100)
          : "",
      date: getRelativeTime(conv.updatedAt),
      messages: conv.messages.length,
      isBookmarked: conv.isBookmarked,
    }));

    res.json(formatted);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching conversations", error: error.message });
  }
});

// Get single conversation
app.get("/api/chatbot/conversations/:id", authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    res.json(conversation);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching conversation", error: error.message });
  }
});

// Create new conversation
app.post("/api/chatbot/conversations", authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;

    const conversation = new Conversation({
      userId: req.user.userId,
      title: title || "New Conversation",
      messages: [],
    });

    await conversation.save();
    res.status(201).json(conversation);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error creating conversation", error: error.message });
  }
});

// Send message and get AI response (MAIN CHATBOT ENDPOINT)
app.post("/api/chatbot/chat", authMiddleware, async (req, res) => {
  try {
    const { message, conversationId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const language = detectLanguage(message);
    const isLawQuery = isLawRelated(message);

    let conversation;
    let conversationHistory = [];

    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        userId: req.user.userId,
      });
      if (conversation) {
        conversationHistory = conversation.messages;
      }
    }

    if (!conversation) {
      const title =
        message.length > 50 ? message.substring(0, 47) + "..." : message;
      conversation = new Conversation({
        userId: req.user.userId,
        title: title,
        messages: [],
      });
    }

    const dbResults = await searchInDatabase(message, req.user.userId);

    const { response, sources } = await generateAIResponse(
      message,
      language,
      dbResults,
      isLawQuery,
      conversationHistory
    );

    conversation.messages.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });

    conversation.messages.push({
      role: "assistant",
      content: response,
      timestamp: new Date(),
      sources: sources,
    });

    conversation.updatedAt = new Date();
    await conversation.save();

    res.json({
      response,
      conversationId: conversation._id,
      sources,
      isLawRelated: isLawQuery,
      language,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      message: "Error processing chat",
      error: error.message,
    });
  }
});

// Delete conversation
app.delete(
  "/api/chatbot/conversations/:id",
  authMiddleware,
  async (req, res) => {
    try {
      const conversation = await Conversation.findOneAndDelete({
        _id: req.params.id,
        userId: req.user.userId,
      });

      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      res.json({ message: "Conversation deleted successfully" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error deleting conversation", error: error.message });
    }
  }
);

// Toggle bookmark
app.patch(
  "/api/chatbot/conversations/:id/bookmark",
  authMiddleware,
  async (req, res) => {
    try {
      const conversation = await Conversation.findOne({
        _id: req.params.id,
        userId: req.user.userId,
      });

      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      conversation.isBookmarked = !conversation.isBookmarked;
      await conversation.save();

      res.json({ isBookmarked: conversation.isBookmarked });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error updating bookmark", error: error.message });
    }
  }
);

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "uploads/cases"; // The default path

    // FIX: Check the API route to determine the correct upload folder
    if (req.originalUrl.includes("/api/more-about-cards")) {
      uploadPath = "uploads/more-about-cards";
    } else if (req.originalUrl.includes("/api/latest-updates")) {
      uploadPath = "uploads/latest-updates";
    } else if (req.originalUrl.includes("/api/books")) {
      if (file.fieldname === "image") {
        uploadPath = "uploads/book-images";
      } else if (file.fieldname === "pdfFile") {
        uploadPath = "uploads/books";
      }
    } else if (req.originalUrl.includes("/api/cases")) {
      // This is the existing logic for case-specific uploads, which is correct
      const { sectionType } = req.body;
      switch (sectionType) {
        case "drafts":
        case "opponentDrafts":
          uploadPath = "uploads/drafts";
          break;
        case "evidence":
          uploadPath = "uploads/evidence";
          break;
        case "courtOrders":
          uploadPath = "uploads/court-orders";
          break;
        default:
          uploadPath = "uploads/cases";
      }
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype === "application/pdf"
  ) {
    cb(null, true);
  } else {
    cb(new Error("Only images and PDF files are allowed!"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for books, 10MB for others
  },
});

// Special upload for books (both image and PDF)
const uploadBook = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === "image") {
        cb(null, "uploads/book-images");
      } else if (file.fieldname === "pdfFile") {
        cb(null, "uploads/books");
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const prefix = file.fieldname === "image" ? "book-image-" : "book-";
      cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "image" && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else if (
      file.fieldname === "pdfFile" &&
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type!"), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ==================== HELPER FUNCTIONS ====================
const getFileSize = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;
    const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
    return `${fileSizeInMB} MB`;
  } catch (error) {
    return "Unknown";
  }
};

const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Error deleting file:", error);
  }
};

// ============================================
// ENHANCED AUTH ROUTES WITH SUBSCRIPTION
// ============================================

// Register with Auto Trial (Enhanced)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Calculate trial dates - CHANGED TO 15 DAYS
    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 15); // 15-day trial

    const user = new User({
      name: name || email.split("@")[0],
      email,
      password,
      trialStartDate,
      trialEndDate,
      subscriptionStatus: "trial",
      onboardingCompleted: false, // ✅ SET THIS TO FALSE FOR NEW USERS
    });

    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(201).json({
      message: "Registration successful! Your 15-day free trial has started.",
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus,
        trialEndDate: user.trialEndDate,
        hasActiveSubscription: true,
        onboardingCompleted: false, // ✅ INCLUDE THIS
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

// Login (Enhanced)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const hasActiveSubscription = user.hasActiveSubscription();
    const isTrialActive = user.isTrialActive();

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // IMPORTANT: Always allow login, never block or redirect
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,

        // ✅ ADD THESE PROFILE FIELDS
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        province: user.province,
        city: user.city,
        courtName: user.courtName,
        barCouncilNumber: user.barCouncilNumber,
        profilePicture: user.profilePicture,
        onboardingCompleted: user.onboardingCompleted,

        // Keep existing subscription fields
        subscriptionStatus: user.subscriptionStatus,
        isSubscribed: user.isSubscribed,
        trialEndDate: user.trialEndDate,
        subscriptionEndDate: user.subscriptionEndDate,
        hasActiveSubscription,
        isTrialActive,
        requiresPayment: !hasActiveSubscription,
        isPaid: user.isPaid,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
});

// ✅ COMPLETE PROFILE ROUTE (POST /api/auth/complete-profile)
app.post(
  "/api/auth/complete-profile",
  authMiddleware,
  upload.single("profilePicture"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
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
      user.onboardingCompleted = true;

      // Handle profile picture if uploaded
      if (req.file) {
        user.profilePicture = `/uploads/profiles/${req.file.filename}`;
      }

      await user.save();

      // Return updated user (exclude password)
      const userResponse = {
        id: user._id,
        email: user.email,
        name: user.name,
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
        subscriptionEndDate: user.subscriptionEndDate,
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

// Get User Profile (Enhanced)
app.get("/api/auth/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasActiveSubscription = user.hasActiveSubscription();
    const isTrialActive = user.isTrialActive();

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        subscriptionStatus: user.subscriptionStatus,
        isSubscribed: user.isSubscribed,
        trialStartDate: user.trialStartDate,
        trialEndDate: user.trialEndDate,
        subscriptionStartDate: user.subscriptionStartDate,
        subscriptionEndDate: user.subscriptionEndDate,
        hasActiveSubscription,
        isTrialActive,
        requiresPayment: !hasActiveSubscription,
        paymentStatus: user.paymentStatus,
        isPaid: user.isPaid, // Legacy field
      },
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================
// ENHANCED PAYMENT ROUTES
// ============================================

// Create Payment Intent (for all methods)
app.post("/api/payments/create", authMiddleware, async (req, res) => {
  try {
    const { paymentMethod, accountNumber, senderName } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Create payment record
    const payment = new Payment({
      userId: user._id,
      amount: 700,
      currency: "PKR",
      paymentMethod,
      accountNumber,
      senderName,
      status: paymentMethod === "card" ? "pending" : "pending", // Manual verification needed for local methods
    });

    await payment.save();

    res.json({
      message: "Payment initiated",
      paymentId: payment._id,
      amount: 700,
      currency: "PKR",
      paymentMethod,
      status: payment.status,
    });
  } catch (error) {
    console.error("Payment creation error:", error);
    res.status(500).json({ message: "Failed to create payment" });
  }
});

// Stripe Payment Intent
app.post(
  "/api/payments/stripe/create-intent",
  authMiddleware,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);

      // Create Stripe customer if doesn't exist
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user._id.toString() },
        });
        customerId = customer.id;
        user.stripeCustomerId = customerId;
        await user.save();
      }

      // Create payment intent (700 PKR = ~2.5 USD, adjust as needed)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 250, // Amount in cents (for USD)
        currency: "usd", // Stripe doesn't support PKR, use USD
        customer: customerId,
        metadata: {
          userId: user._id.toString(),
          subscriptionType: "monthly",
        },
      });

      // Create payment record
      const payment = new Payment({
        userId: user._id,
        amount: 700,
        currency: "PKR",
        paymentMethod: "card",
        stripePaymentIntentId: paymentIntent.id,
        status: "pending",
      });

      await payment.save();

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentId: payment._id,
      });
    } catch (error) {
      console.error("Stripe intent error:", error);
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  }
);

// Verify Payment (Manual verification for bank/wallet)
app.post(
  "/api/payments/verify/:paymentId",
  authMiddleware,
  async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { transactionId, receiptUrl } = req.body;

      const payment = await Payment.findById(paymentId);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Update payment
      payment.transactionId = transactionId;
      payment.receiptUrl = receiptUrl;
      payment.status = "pending"; // Admin will verify
      await payment.save();

      res.json({
        message: "Payment submitted for verification",
        payment: {
          id: payment._id,
          status: payment.status,
          amount: payment.amount,
        },
      });
    } catch (error) {
      console.error("Payment verification error:", error);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  }
);

// Admin: Approve Payment
app.post(
  "/api/admin/payments/approve/:paymentId",
  authMiddleware,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const payment = await Payment.findById(req.params.paymentId);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      // Update payment status
      payment.status = "verified";
      payment.verifiedBy = user._id;
      payment.verifiedAt = new Date();
      await payment.save();

      // Update user subscription
      const subscribedUser = await User.findById(payment.userId);
      subscribedUser.isSubscribed = true;
      subscribedUser.subscriptionStatus = "active";
      subscribedUser.subscriptionStartDate = new Date();

      // Add 30 days to subscription
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);
      subscribedUser.subscriptionEndDate = endDate;

      subscribedUser.paymentStatus = "completed";
      subscribedUser.paymentMethod = payment.paymentMethod;
      subscribedUser.isPaid = true; // Legacy field

      await subscribedUser.save();

      res.json({
        message: "Payment approved and subscription activated",
        payment,
        user: {
          id: subscribedUser._id,
          email: subscribedUser.email,
          subscriptionEndDate: subscribedUser.subscriptionEndDate,
        },
      });
    } catch (error) {
      console.error("Payment approval error:", error);
      res.status(500).json({ message: "Failed to approve payment" });
    }
  }
);

// ============================================
// SUBSCRIPTION STATUS ROUTES
// ============================================

// Check if subscription is needed
// ============================================
// ✅ UPDATED: Get subscription status WITH DAILY LIMITS
// ============================================
app.get("/api/subscription/status", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasActiveSubscription = user.hasActiveSubscription();
    const isTrialActive = user.isTrialActive();

    // Reset daily limits if needed
    user.resetDailyLimitsIfNeeded();
    await user.save();

    // Calculate days remaining
    let daysRemaining = 0;
    if (isTrialActive && user.trialEndDate) {
      const now = new Date();
      const diff = user.trialEndDate - now;
      daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));
    } else if (user.subscriptionEndDate) {
      const now = new Date();
      const diff = user.subscriptionEndDate - now;
      daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    res.json({
      hasActiveSubscription,
      isTrialActive,
      subscriptionStatus: user.subscriptionStatus,
      daysRemaining: Math.max(0, daysRemaining),
      trialEndDate: user.trialEndDate,
      subscriptionEndDate: user.subscriptionEndDate,
      requiresPayment: !hasActiveSubscription,
      isSubscribed: user.isSubscribed,
      isPaid: user.isPaid,

      // ✅ NEW: Include daily limits info
      dailyLimits: {
        cases: {
          limit: user.isSubscribed || user.role === "admin" ? "unlimited" : 2,
          used: user.dailyLimits.casesCreatedToday,
          remaining:
            user.isSubscribed || user.role === "admin"
              ? "unlimited"
              : Math.max(0, 2 - user.dailyLimits.casesCreatedToday),
        },
        notes: {
          limit: user.isSubscribed || user.role === "admin" ? "unlimited" : 2,
          used: user.dailyLimits.notesCreatedToday,
          remaining:
            user.isSubscribed || user.role === "admin"
              ? "unlimited"
              : Math.max(0, 2 - user.dailyLimits.notesCreatedToday),
        },
        downloads: {
          limit: user.isSubscribed || user.role === "admin" ? "unlimited" : 2,
          used: user.dailyLimits.booksDownloadedToday,
          remaining:
            user.isSubscribed || user.role === "admin"
              ? "unlimited"
              : Math.max(0, 2 - user.dailyLimits.booksDownloadedToday),
        },
      },
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================
// ✅ NEW: Get daily limits status (for frontend display)
// ============================================
app.get("/api/subscription/daily-limits", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.resetDailyLimitsIfNeeded();
    await user.save();

    res.json({
      cases: {
        limit: user.isSubscribed || user.role === "admin" ? "unlimited" : 2,
        used: user.dailyLimits.casesCreatedToday,
        remaining:
          user.isSubscribed || user.role === "admin"
            ? "unlimited"
            : Math.max(0, 2 - user.dailyLimits.casesCreatedToday),
        canCreate: user.canCreateCase(),
      },
      notes: {
        limit: user.isSubscribed || user.role === "admin" ? "unlimited" : 2,
        used: user.dailyLimits.notesCreatedToday,
        remaining:
          user.isSubscribed || user.role === "admin"
            ? "unlimited"
            : Math.max(0, 2 - user.dailyLimits.notesCreatedToday),
        canCreate: user.canCreateNote(),
      },
      downloads: {
        limit: user.isSubscribed || user.role === "admin" ? "unlimited" : 2,
        used: user.dailyLimits.booksDownloadedToday,
        remaining:
          user.isSubscribed || user.role === "admin"
            ? "unlimited"
            : Math.max(0, 2 - user.dailyLimits.booksDownloadedToday),
        canDownload: user.canDownloadBook(),
      },
    });
  } catch (error) {
    console.error("Error fetching daily limits:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================
// ADMIN PAYMENT ROUTES (NEW)
// ============================================

// Get all payments (Admin only)
app.get("/api/admin/payments", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { status } = req.query;

    let query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const payments = await Payment.find(query)
      .populate("userId", "email name")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ payments });
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Reject Payment (Admin only)
app.post(
  "/api/admin/payments/reject/:paymentId",
  authMiddleware,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.userId);
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { reason } = req.body;
      const payment = await Payment.findById(req.params.paymentId);

      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      payment.status = "failed";
      payment.notes = reason || "Payment rejected by admin";
      payment.verifiedBy = user._id;
      payment.verifiedAt = new Date();
      await payment.save();

      res.json({
        message: "Payment rejected",
        payment,
      });
    } catch (error) {
      console.error("Payment rejection error:", error);
      res.status(500).json({ message: "Failed to reject payment" });
    }
  }
);

// ============================================
// AUTOMATED SUBSCRIPTION TASKS
// ============================================

async function checkExpiredSubscriptions() {
  try {
    const now = new Date();

    const expiredTrials = await User.updateMany(
      {
        subscriptionStatus: "trial",
        trialEndDate: { $lt: now },
        isSubscribed: false,
      },
      { $set: { subscriptionStatus: "expired" } }
    );

    const expiredSubscriptions = await User.updateMany(
      {
        isSubscribed: true,
        subscriptionEndDate: { $lt: now },
      },
      {
        $set: {
          isSubscribed: false,
          subscriptionStatus: "expired",
        },
      }
    );

    console.log(
      `✅ Expired ${expiredTrials.modifiedCount} trials and ${expiredSubscriptions.modifiedCount} subscriptions`
    );
  } catch (error) {
    console.error("Error checking expired subscriptions:", error);
  }
}

// Run check every hour
setInterval(checkExpiredSubscriptions, 60 * 60 * 1000);

// ============================================
// EXISTING PAYMENT ROUTES (For Compatibility)
// ============================================

app.post(
  "/api/pay/create-checkout-session",
  authMiddleware,
  async (req, res) => {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "Voice of Law - $2 Access" },
              unit_amount: 200,
            },
            quantity: 1,
          },
        ],
        success_url:
          process.env.CLIENT_URL + "/auth/login?payment_status=success",
        cancel_url:
          process.env.CLIENT_URL + "/auth/login?payment_status=canceled",
        metadata: {
          userId: req.user.userId,
        },
      });

      res.json({ url: session.url });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  }
);

// Blog Content Routes
app.get("/api/blog-data", async (req, res) => {
  try {
    const posts = await Post.find({});
    const categories = [
      ...new Set(posts.map((p) => p.category).filter((c) => c)),
    ];
    const tags = ["Law-Tech", "Updates", "Pakistan", "Legal"];
    const pickedCards = posts.filter((p) => p.type === "picked");
    const latestPosts = posts.filter((p) => p.type === "latest");
    const featuredPosts = posts.filter((p) => p.type === "featured");

    res.json({ categories, tags, pickedCards, latestPosts, featuredPosts });
  } catch (err) {
    res.status(500).send("Server error");
  }
});

app.get("/api/posts/:id", authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).send("Post not found");
    }

    const user = await User.findById(req.user.userId);
    if (!user || (!user.hasActiveSubscription() && user.role !== "admin")) {
      return res
        .status(403)
        .json({ message: "Subscription required to view full content" });
    }
    res.json(post);
  } catch (err) {
    res.status(500).send("Server error");
  }
});

// --- Enhanced Case Management Routes ---

// Get all cases for authenticated user
app.get("/api/cases", authMiddleware, async (req, res) => {
  try {
    const cases = await Case.find({ userId: req.user.userId })
      .populate("drafts.fileId")
      .populate("drafts.noteId")
      .populate("opponentDrafts.fileId")
      .populate("opponentDrafts.noteId")
      .populate("courtOrders.fileId")
      .populate("courtOrders.noteId")
      .populate("evidence.fileId")
      .populate("evidence.noteId")
      .populate("relevantSections.fileId")
      .populate("relevantSections.noteId")
      .sort({ createdAt: -1 });

    res.json(cases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single case
app.get("/api/cases/:id", authMiddleware, async (req, res) => {
  try {
    const caseItem = await Case.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    })
      .populate({
        path: "drafts.fileId",
        model: "File",
      })
      .populate({
        path: "drafts.noteId",
        model: "Note",
      })
      .populate({
        path: "opponentDrafts.fileId",
        model: "File",
      })
      .populate({
        path: "opponentDrafts.noteId",
        model: "Note",
      })
      .populate({
        path: "courtOrders.fileId",
        model: "File",
      })
      .populate({
        path: "courtOrders.noteId",
        model: "Note",
      })
      .populate({
        path: "evidence.fileId",
        model: "File",
      })
      .populate({
        path: "evidence.noteId",
        model: "Note",
      })
      .populate({
        path: "relevantSections.fileId",
        model: "File",
      })
      .populate({
        path: "relevantSections.noteId",
        model: "Note",
      });

    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }

    res.json(caseItem);
  } catch (error) {
    console.error("Case fetch error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Create new case
// ============================================
// ✅ UPDATED: Create new case WITH DAILY LIMIT CHECK
// ============================================
app.post("/api/cases", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Check if user can create case (admin, subscribed, or trial with limits)
    if (!user.canCreateCase()) {
      return res.status(403).json({
        message: "Daily limit reached",
        error:
          "You have reached your daily limit of 2 cases. Upgrade to premium for unlimited access.",
        limitType: "cases",
        dailyLimit: 2,
        usedToday: user.dailyLimits.casesCreatedToday,
      });
    }

    const caseData = {
      title: req.body.caseTitle || req.body.title,
      court: req.body.courtName || req.body.court,
      type: req.body.caseType || req.body.type,
      caseNo: req.body.caseNo,
      caseYear: req.body.caseYear,
      onBehalfOf: req.body.onBehalfOf,
      partyName: req.body.partyName,
      contactNumber: req.body.contactNumber,
      respondent: req.body.respondentName || req.body.respondent,
      lawyer: req.body.lawyerName || req.body.lawyer,
      advocateContactNumber: req.body.advocateContactNumber,
      adversePartyAdvocateName: req.body.adversePartyAdvocateName,
      description: req.body.description,
      nextHearing: req.body.nextHearing,
      status: req.body.status || "pending",
      userId: req.user.userId,
    };

    const newCase = new Case(caseData);
    const savedCase = await newCase.save();

    // ✅ Increment case count for trial users
    if (user.isTrialActive() && !user.isSubscribed) {
      await user.incrementCaseCount();
    }

    res.status(201).json(savedCase);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Case number already exists" });
    }
    res.status(400).json({ message: error.message });
  }
});

// Update case
app.put("/api/cases/:id", authMiddleware, async (req, res) => {
  try {
    const updateData = {
      title: req.body.caseTitle || req.body.title,
      court: req.body.courtName || req.body.court,
      type: req.body.caseType || req.body.type,
      caseNo: req.body.caseNo,
      caseYear: req.body.caseYear,
      onBehalfOf: req.body.onBehalfOf,
      partyName: req.body.partyName,
      contactNumber: req.body.contactNumber,
      respondent: req.body.respondentName || req.body.respondent,
      lawyer: req.body.lawyerName || req.body.lawyer,
      advocateContactNumber: req.body.advocateContactNumber,
      adversePartyAdvocateName: req.body.adversePartyAdvocateName,
      description: req.body.description,
      nextHearing: req.body.nextHearing,
      status: req.body.status,
      updatedAt: new Date(),
    };

    const caseItem = await Case.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }

    res.json(caseItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete case
app.delete("/api/cases/:id", authMiddleware, async (req, res) => {
  try {
    const caseItem = await Case.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }

    res.json({ message: "Case deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// File Upload Routes
app.post(
  "/api/cases/:id/upload",
  authMiddleware,
  upload.array("files"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { sectionType } = req.body;

      const caseData = await Case.findOne({
        _id: id,
        userId: req.user.userId,
      });

      if (!caseData) {
        return res.status(404).json({ message: "Case not found" });
      }

      const uploadedFiles = [];

      for (const file of req.files) {
        const fileDoc = new File({
          originalName: file.originalname,
          filename: file.filename,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
          uploadedBy: req.user.userId,
        });

        await fileDoc.save();

        const fileEntry = {
          type: "file",
          fileId: fileDoc._id,
          name: file.originalname,
          addedAt: new Date(),
        };

        caseData[sectionType].push(fileEntry);
        uploadedFiles.push({
          id: fileDoc._id,
          name: file.originalname,
          type: "file",
          size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
          dateAdded: new Date().toISOString().split("T")[0],
          url: `/uploads/${path.relative("uploads", file.path)}`,
        });
      }

      await caseData.save();

      res.json({
        message: "Files uploaded successfully",
        files: uploadedFiles,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// Note Routes for cases
app.post("/api/cases/:id/notes", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { sectionType, title, content = "" } = req.body;

    const caseData = await Case.findOne({
      _id: id,
      userId: req.user.userId,
    });

    if (!caseData) {
      return res.status(404).json({ message: "Case not found" });
    }

    const note = new Note({
      title,
      content,
      createdBy: req.user.userId,
    });

    await note.save();

    const noteEntry = {
      type: "note",
      noteId: note._id,
      name: title,
      addedAt: new Date(),
    };

    caseData[sectionType].push(noteEntry);
    await caseData.save();

    res.json({
      message: "Note created successfully",
      note: {
        id: note._id,
        name: title,
        type: "note",
        dateAdded: new Date().toISOString().split("T")[0],
        content: content,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

app.put("/api/notes/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const note = await Note.findOneAndUpdate(
      { _id: id, createdBy: req.user.userId },
      { title, content, updatedAt: new Date() },
      { new: true }
    );

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    res.json({
      message: "Note updated successfully",
      note,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete file/note from case
app.delete(
  "/api/cases/:caseId/items/:itemId",
  authMiddleware,
  async (req, res) => {
    try {
      const { caseId, itemId } = req.params;
      const { sectionType, itemType } = req.body;

      const caseData = await Case.findOne({
        _id: caseId,
        userId: req.user.userId,
      });

      if (!caseData) {
        return res.status(404).json({ message: "Case not found" });
      }

      const sectionItems = caseData[sectionType];
      const itemIndex = sectionItems.findIndex((item) => {
        if (itemType === "file" && item.fileId) {
          return item.fileId.toString() === itemId;
        } else if (itemType === "note" && item.noteId) {
          return item.noteId.toString() === itemId;
        }
        return false;
      });

      if (itemIndex === -1) {
        return res.status(404).json({ message: "Item not found" });
      }

      sectionItems.splice(itemIndex, 1);
      await caseData.save();

      if (itemType === "file") {
        const file = await File.findById(itemId);
        if (file) {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
          await File.findByIdAndDelete(itemId);
        }
      } else if (itemType === "note") {
        await Note.findByIdAndDelete(itemId);
      }

      res.json({ message: "Item deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// Get file content
app.get("/api/files/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const file = await File.findOne({
      _id: id,
      uploadedBy: req.user.userId,
    });

    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    res.json({
      id: file._id,
      name: file.originalName,
      mimetype: file.mimetype,
      size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
      uploadedAt: file.uploadedAt,
      url: `/uploads/${path.relative("uploads", file.path)}`,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get note content
app.get("/api/notes/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const note = await Note.findOne({
      _id: id,
      createdBy: req.user.userId,
    });

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    res.json(note);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Status update route
app.patch("/api/cases/:id/status", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["pending", "completed", "hearing"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updatedCase = await Case.findOneAndUpdate(
      { _id: id, userId: req.user.userId },
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedCase) {
      return res.status(404).json({ message: "Case not found" });
    }

    res.json({
      message: "Status updated successfully",
      data: updatedCase,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// =============== MORE ABOUT CARDS ROUTES ===============

app.get("/api/more-about-cards", async (req, res) => {
  try {
    const cards = await MoreAboutCard.find({}).sort({ createdAt: -1 });
    console.log(`✅ GET /api/more-about-cards - Found ${cards.length} cards`);
    res.json(cards);
  } catch (error) {
    console.error("❌ GET /api/more-about-cards error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.get("/api/more-about-cards/category/:category", async (req, res) => {
  try {
    const category = req.params.category;
    const cards = await MoreAboutCard.find({ category });
    console.log(
      `✅ GET /api/more-about-cards/category/${category} - Found ${cards.length} cards`
    );
    res.json(cards);
  } catch (error) {
    console.error("❌ GET /api/more-about-cards/category error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.get("/api/more-about-cards/:id", async (req, res) => {
  try {
    const card = await MoreAboutCard.findById(req.params.id);
    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }
    console.log(`✅ GET /api/more-about-cards/${req.params.id}`);
    res.json(card);
  } catch (error) {
    console.error("❌ GET /api/more-about-cards/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.post(
  "/api/more-about-cards",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      console.log("📝 POST /api/more-about-cards - Body:", req.body);
      const { category, date, title, description, isLocked } = req.body;

      if (!title || !description || !category || !date) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["title", "description", "category", "date"],
        });
      }

      let imagePath = "/uploads/more-about-cards/default.jpg";
      if (req.file) {
        const correctSubfolder = "more-about-cards";
        const correctDestDir = path.join(
          __dirname,
          "uploads",
          correctSubfolder
        );
        fs.mkdirSync(correctDestDir, { recursive: true });
        const newPath = path.join(correctDestDir, req.file.filename);
        fs.renameSync(req.file.path, newPath);
        imagePath = `/uploads/${correctSubfolder}/${req.file.filename}`;
      }

      const newCard = new MoreAboutCard({
        category,
        image: imagePath,
        date,
        title,
        description,
        isLocked: isLocked === "true" || isLocked === true,
      });

      await newCard.save();
      console.log(
        `✅ POST /api/more-about-cards - Created card ID: ${newCard._id}`
      );
      res.status(201).json(newCard);
    } catch (error) {
      console.error("❌ POST /api/more-about-cards error:", error);
      res.status(500).json({ error: "Server error", message: error.message });
    }
  }
);

app.put(
  "/api/more-about-cards/:id",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      console.log(
        `✏️ PUT /api/more-about-cards/${req.params.id} - Body:`,
        req.body
      );
      const { category, date, title, description, isLocked } = req.body;

      const updateData = {
        category,
        date,
        title,
        description,
        isLocked: isLocked === "true" || isLocked === true,
      };

      if (req.file) {
        const correctSubfolder = "more-about-cards";
        const correctDestDir = path.join(
          __dirname,
          "uploads",
          correctSubfolder
        );
        fs.mkdirSync(correctDestDir, { recursive: true });
        const newPath = path.join(correctDestDir, req.file.filename);
        fs.renameSync(req.file.path, newPath);
        updateData.image = `/uploads/${correctSubfolder}/${req.file.filename}`;
      }

      const card = await MoreAboutCard.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );

      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }

      console.log(`✅ PUT /api/more-about-cards/${req.params.id} - Updated`);
      res.json(card);
    } catch (error) {
      console.error("❌ PUT /api/more-about-cards/:id error:", error);
      res.status(500).json({ error: "Server error", message: error.message });
    }
  }
);

app.delete("/api/more-about-cards/:id", authMiddleware, async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/more-about-cards/${req.params.id}`);
    const card = await MoreAboutCard.findByIdAndDelete(req.params.id);
    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }
    console.log(`✅ DELETE /api/more-about-cards/${req.params.id} - Deleted`);
    res.json({ message: "Card deleted successfully" });
  } catch (error) {
    console.error("❌ DELETE /api/more-about-cards/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

// =============== LATEST UPDATES ROUTES ===============

app.get("/api/latest-updates", async (req, res) => {
  try {
    const updates = await LatestUpdate.find({}).sort({ createdAt: -1 });
    console.log(`✅ GET /api/latest-updates - Found ${updates.length} updates`);
    res.json(updates);
  } catch (error) {
    console.error("❌ GET /api/latest-updates error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.get("/api/latest-updates/:id", async (req, res) => {
  try {
    const update = await LatestUpdate.findById(req.params.id);
    if (!update) {
      return res.status(404).json({ error: "Update not found" });
    }
    console.log(`✅ GET /api/latest-updates/${req.params.id}`);
    res.json(update);
  } catch (error) {
    console.error("❌ GET /api/latest-updates/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.post(
  "/api/latest-updates",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      console.log("📝 POST /api/latest-updates - Body:", req.body);
      const { title, summary, details, date, type, gradient } = req.body;

      if (!title || !summary || !details || !date || !type) {
        return res.status(400).json({
          error: "Missing required fields",
          required: ["title", "summary", "details", "date", "type"],
        });
      }

      let imagePath = "/uploads/latest-updates/default.jpg";
      if (req.file) {
        const correctSubfolder = "latest-updates";
        const correctDestDir = path.join(
          __dirname,
          "uploads",
          correctSubfolder
        );
        fs.mkdirSync(correctDestDir, { recursive: true });
        const newPath = path.join(correctDestDir, req.file.filename);
        fs.renameSync(req.file.path, newPath);
        imagePath = `/uploads/${correctSubfolder}/${req.file.filename}`;
      }

      const newUpdate = new LatestUpdate({
        title,
        summary,
        details,
        date,
        type,
        image: imagePath,
        gradient:
          gradient || "linear-gradient(135deg, #454444 0%, #c79f44 100%)",
      });

      await newUpdate.save();
      console.log(
        `✅ POST /api/latest-updates - Created update ID: ${newUpdate._id}`
      );
      res.status(201).json(newUpdate);
    } catch (error) {
      console.error("❌ POST /api/latest-updates error:", error);
      res.status(500).json({ error: "Server error", message: error.message });
    }
  }
);

app.put(
  "/api/latest-updates/:id",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      console.log(
        `✏️ PUT /api/latest-updates/${req.params.id} - Body:`,
        req.body
      );
      const { title, summary, details, date, type, gradient } = req.body;

      const updateData = { title, summary, details, date, type, gradient };

      if (req.file) {
        const correctSubfolder = "latest-updates";
        const correctDestDir = path.join(
          __dirname,
          "uploads",
          correctSubfolder
        );
        fs.mkdirSync(correctDestDir, { recursive: true });
        const newPath = path.join(correctDestDir, req.file.filename);
        fs.renameSync(req.file.path, newPath);
        updateData.image = `/uploads/${correctSubfolder}/${req.file.filename}`;
      }

      const update = await LatestUpdate.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );

      if (!update) {
        return res.status(404).json({ error: "Update not found" });
      }

      console.log(`✅ PUT /api/latest-updates/${req.params.id} - Updated`);
      res.json(update);
    } catch (error) {
      console.error("❌ PUT /api/latest-updates/:id error:", error);
      res.status(500).json({ error: "Server error", message: error.message });
    }
  }
);

app.delete("/api/latest-updates/:id", authMiddleware, async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/latest-updates/${req.params.id}`);
    const update = await LatestUpdate.findByIdAndDelete(req.params.id);
    if (!update) {
      return res.status(404).json({ error: "Update not found" });
    }
    console.log(`✅ DELETE /api/latest-updates/${req.params.id} - Deleted`);
    res.json({ message: "Update deleted successfully" });
  } catch (error) {
    console.error("❌ DELETE /api/latest-updates/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

// =============== ANNOUNCEMENTS ROUTES ===============

app.get("/api/announcements", async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    if (category && category !== "ALL") {
      filter.category = category;
    }
    const announcements = await Announcement.find(filter).sort({
      createdAt: -1,
    });
    console.log(
      `✅ GET /api/announcements - Found ${announcements.length} announcements`
    );
    res.json(announcements);
  } catch (error) {
    console.error("❌ GET /api/announcements error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.get("/api/announcements/:id", async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: "Announcement not found" });
    }
    console.log(`✅ GET /api/announcements/${req.params.id}`);
    res.json(announcement);
  } catch (error) {
    console.error("❌ GET /api/announcements/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.post("/api/announcements", authMiddleware, async (req, res) => {
  try {
    console.log("📝 POST /api/announcements - Body:", req.body);
    const { date, type, title, link, category, priority } = req.body;

    if (!date || !type || !title || !category) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["date", "type", "title", "category"],
      });
    }

    const newAnnouncement = new Announcement({
      date,
      type,
      title,
      link: link || "#",
      category,
      priority: priority || "medium",
    });

    await newAnnouncement.save();
    console.log(
      `✅ POST /api/announcements - Created announcement ID: ${newAnnouncement._id}`
    );
    res.status(201).json(newAnnouncement);
  } catch (error) {
    console.error("❌ POST /api/announcements error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.put("/api/announcements/:id", authMiddleware, async (req, res) => {
  try {
    console.log(`✏️ PUT /api/announcements/${req.params.id} - Body:`, req.body);
    const { date, type, title, link, category, priority } = req.body;

    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      {
        date,
        type,
        title,
        link: link || "#",
        category,
        priority: priority || "medium",
      },
      { new: true, runValidators: true }
    );

    if (!announcement) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    console.log(`✅ PUT /api/announcements/${req.params.id} - Updated`);
    res.json(announcement);
  } catch (error) {
    console.error("❌ PUT /api/announcements/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

app.delete("/api/announcements/:id", authMiddleware, async (req, res) => {
  try {
    console.log(`🗑️ DELETE /api/announcements/${req.params.id}`);
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: "Announcement not found" });
    }
    console.log(`✅ DELETE /api/announcements/${req.params.id} - Deleted`);
    res.json({ message: "Announcement deleted successfully" });
  } catch (error) {
    console.error("❌ DELETE /api/announcements/:id error:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

// =============== BOOK ROUTES ===============
// GET all books
app.get("/api/books", async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = { isActive: true };

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { author: { $regex: search, $options: "i" } },
      ];
    }

    const books = await Book.find(query).sort({ createdAt: -1 });
    console.log(`✅ GET /api/books - Found ${books.length} books`);
    res.json({ success: true, data: books });
  } catch (error) {
    console.error("❌ GET /api/books error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching books",
      error: error.message,
    });
  }
});

// GET single book by ID
app.get("/api/books/:id", async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      console.log(`❌ GET /api/books/${req.params.id} - Book not found`);
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }
    console.log(`✅ GET /api/books/${req.params.id}`);
    res.json({ success: true, data: book });
  } catch (error) {
    console.error(`❌ GET /api/books/${req.params.id} error:`, error);
    res.status(500).json({
      success: false,
      message: "Error fetching book",
      error: error.message,
    });
  }
});

// POST create new book
app.post(
  "/api/books",
  authMiddleware,
  uploadBook.fields([
    { name: "image", maxCount: 1 },
    { name: "pdfFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("📝 POST /api/books - Creating book with data:", req.body);

      if (!req.files || !req.files.image || !req.files.pdfFile) {
        console.error("❌ POST /api/books - Missing files (image or PDF)");
        return res.status(400).json({
          success: false,
          message: "Both image and PDF file are required",
        });
      }

      if (!req.body.title || !req.body.description || !req.body.category) {
        console.error("❌ POST /api/books - Missing required fields");
        if (req.files) {
          if (req.files.image) deleteFile(req.files.image[0].path);
          if (req.files.pdfFile) deleteFile(req.files.pdfFile[0].path);
        }
        return res.status(400).json({
          success: false,
          message: "Title, description, and category are required",
        });
      }

      const imagePath = "/uploads/book-images/" + req.files.image[0].filename;
      const pdfPath = "/uploads/books/" + req.files.pdfFile[0].filename;
      const fileSize = getFileSize(req.files.pdfFile[0].path);

      const bookData = {
        title: req.body.title,
        description: req.body.description,
        category: req.body.category,
        author: req.body.author || "",
        image: imagePath,
        pdfFile: pdfPath,
        fileSize: fileSize,
        publishedDate: req.body.publishedDate || Date.now(),
        isActive: true,
      };

      const newBook = new Book(bookData);
      await newBook.save();

      console.log("✅ POST /api/books - Book created:", newBook._id);
      res.status(201).json({
        success: true,
        message: "Book created successfully",
        data: newBook,
      });
    } catch (error) {
      console.error("❌ POST /api/books error:", error);
      if (req.files) {
        if (req.files.image) deleteFile(req.files.image[0].path);
        if (req.files.pdfFile) deleteFile(req.files.pdfFile[0].path);
      }
      res.status(500).json({
        success: false,
        message: "Error creating book",
        error: error.message,
      });
    }
  }
);

// PUT update book
app.put(
  "/api/books/:id",
  authMiddleware,
  uploadBook.fields([
    { name: "image", maxCount: 1 },
    { name: "pdfFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("✏️ PUT /api/books/:id - Updating book:", req.params.id);

      const book = await Book.findById(req.params.id);
      if (!book) {
        console.log(`❌ PUT /api/books/${req.params.id} - Book not found`);
        return res
          .status(404)
          .json({ success: false, message: "Book not found" });
      }

      const updateData = {
        title: req.body.title || book.title,
        description: req.body.description || book.description,
        category: req.body.category || book.category,
        author: req.body.author || book.author,
        publishedDate: req.body.publishedDate || book.publishedDate,
      };

      if (req.files && req.files.image) {
        deleteFile("." + book.image);
        updateData.image =
          "/uploads/book-images/" + req.files.image[0].filename;
      }

      if (req.files && req.files.pdfFile) {
        deleteFile("." + book.pdfFile);
        updateData.pdfFile = "/uploads/books/" + req.files.pdfFile[0].filename;
        updateData.fileSize = getFileSize(req.files.pdfFile[0].path);
      }

      const updatedBook = await Book.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      );

      console.log("✅ PUT /api/books/:id - Book updated:", updatedBook._id);
      res.json({
        success: true,
        message: "Book updated successfully",
        data: updatedBook,
      });
    } catch (error) {
      console.error("❌ PUT /api/books/:id error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating book",
        error: error.message,
      });
    }
  }
);

// DELETE book
app.delete("/api/books/:id", authMiddleware, async (req, res) => {
  try {
    console.log("🗑️ DELETE /api/books/:id - Deleting book:", req.params.id);

    const book = await Book.findById(req.params.id);
    if (!book) {
      console.log(`❌ DELETE /api/books/${req.params.id} - Book not found`);
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }

    deleteFile("." + book.image);
    deleteFile("." + book.pdfFile);

    await Book.findByIdAndDelete(req.params.id);

    console.log("✅ DELETE /api/books/:id - Book deleted:", req.params.id);
    res.json({
      success: true,
      message: "Book deleted successfully",
    });
  } catch (error) {
    console.error("❌ DELETE /api/books/:id error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting book",
      error: error.message,
    });
  }
});

// ============================================
// ✅ Download book WITH DAILY LIMIT CHECK
// ============================================
app.get("/api/books/:id/download", authMiddleware, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Check if user can download book (admin, subscribed, or trial with limits)
    if (!user.canDownloadBook()) {
      return res.status(403).json({
        message: "Daily limit reached",
        error:
          "You have reached your daily limit of 2 book downloads. Upgrade to premium for unlimited access.",
        limitType: "downloads",
        dailyLimit: 2,
        usedToday: user.dailyLimits.booksDownloadedToday,
      });
    }

    // Increment download count
    book.downloads += 1;
    await book.save();

    // ✅ Increment book download count for trial users
    if (user.isTrialActive() && !user.isSubscribed) {
      await user.incrementBookDownloadCount();
    }

    const filePath = path.join(__dirname, book.pdfFile);
    res.download(filePath, `${book.title}.pdf`);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error downloading book",
      error: error.message,
    });
  }
});

// Get books by category (for stats)
app.get("/api/books/stats/by-category", async (req, res) => {
  try {
    const stats = await Book.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    console.log(`✅ GET /api/books/stats/by-category - Found stats`);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("❌ GET /api/books/stats/by-category error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching stats",
      error: error.message,
    });
  }
});

// =============== UPDATED STANDALONE NOTES ROUTES (USER-SPECIFIC) ===============

// UPDATED: Get all notes for logged-in user only
app.get("/api/standalone/notes", authMiddleware, async (req, res) => {
  try {
    // Only fetch notes created by the logged-in user
    const notes = await StandaloneNote.find({
      createdBy: req.user.userId,
    }).sort({
      createdAt: -1,
    });
    res.json(notes);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching notes", error: error.message });
  }
});

// UPDATED: Get single note by ID (only if user owns it)
app.get("/api/standalone/notes/:id", authMiddleware, async (req, res) => {
  try {
    const note = await StandaloneNote.findOne({
      _id: req.params.id,
      createdBy: req.user.userId, // Ensure user owns the note
    });

    if (!note) {
      return res
        .status(404)
        .json({ message: "Note not found or access denied" });
    }
    res.json(note);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching note", error: error.message });
  }
});

// UPDATED: Create new note (linked to logged-in user)
// ============================================
// ✅ UPDATED: Create new standalone note WITH DAILY LIMIT CHECK
// ============================================
app.post("/api/standalone/notes", authMiddleware, async (req, res) => {
  try {
    const { title, content, date } = req.body;

    if (!title || !content) {
      return res
        .status(400)
        .json({ message: "Title and content are required" });
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Check if user can create note (admin, subscribed, or trial with limits)
    if (!user.canCreateNote()) {
      return res.status(403).json({
        message: "Daily limit reached",
        error:
          "You have reached your daily limit of 2 notes. Upgrade to premium for unlimited access.",
        limitType: "notes",
        dailyLimit: 2,
        usedToday: user.dailyLimits.notesCreatedToday,
      });
    }

    const newNote = new StandaloneNote({
      title,
      content,
      date: date || new Date().toLocaleString(),
      createdBy: req.user.userId,
    });

    const savedNote = await newNote.save();

    // ✅ Increment note count for trial users
    if (user.isTrialActive() && !user.isSubscribed) {
      await user.incrementNoteCount();
    }

    res.status(201).json(savedNote);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error creating note", error: error.message });
  }
});

// UPDATED: Update note (only if user owns it)
app.put("/api/standalone/notes/:id", authMiddleware, async (req, res) => {
  try {
    const { title, content, date } = req.body;

    if (!title || !content) {
      return res
        .status(400)
        .json({ message: "Title and content are required" });
    }

    const updatedNote = await StandaloneNote.findOneAndUpdate(
      {
        _id: req.params.id,
        createdBy: req.user.userId, // Ensure user owns the note
      },
      { title, content, date },
      { new: true, runValidators: true }
    );

    if (!updatedNote) {
      return res
        .status(404)
        .json({ message: "Note not found or access denied" });
    }

    res.json(updatedNote);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating note", error: error.message });
  }
});

// UPDATED: Delete note (only if user owns it)
app.delete("/api/standalone/notes/:id", authMiddleware, async (req, res) => {
  try {
    const deletedNote = await StandaloneNote.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user.userId, // Ensure user owns the note
    });

    if (!deletedNote) {
      return res
        .status(404)
        .json({ message: "Note not found or access denied" });
    }

    res.json({ message: "Note deleted successfully", note: deletedNote });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting note", error: error.message });
  }
});

// UPDATED: Search notes (only user's own notes)
app.get(
  "/api/standalone/notes/search/:query",
  authMiddleware,
  async (req, res) => {
    try {
      const query = req.params.query;
      const notes = await StandaloneNote.find({
        createdBy: req.user.userId, // Only search in user's notes
        $or: [
          { title: { $regex: query, $options: "i" } },
          { content: { $regex: query, $options: "i" } },
        ],
      }).sort({ createdAt: -1 });

      res.json(notes);
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error searching notes", error: error.message });
    }
  }
);

// =============== UTILITY ROUTES ===============

// GET dashboard stats
app.get("/api/dashboard-stats", async (req, res) => {
  try {
    const totalMoreAboutCards = await MoreAboutCard.countDocuments();
    const totalLatestUpdates = await LatestUpdate.countDocuments();
    const totalAnnouncements = await Announcement.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalBooks = await Book.countDocuments({ isActive: true });
    const totalStandaloneNotes = await StandaloneNote.countDocuments();

    const stats = {
      totalMoreAboutCards,
      totalLatestUpdates,
      totalAnnouncements,
      totalUsers,
      totalBooks,
      totalStandaloneNotes,
    };

    console.log("✅ Dashboard stats fetched:", stats);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ error: "Server error", message: error.message });
  }
});

// FIXED: General file upload endpoint for admin dashboard
app.post(
  "/api/upload",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const file = new File({
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
        mimetype: req.file.mimetype,
        size: req.file.size,
        uploadedBy: req.user.userId,
      });

      await file.save();

      res.json({
        message: "File uploaded successfully",
        fileId: file._id,
        url: `/uploads/${path.relative("uploads", req.file.path)}`,
        filename: req.file.filename,
        originalName: req.file.originalname,
      });
    } catch (error) {
      console.error("File upload error:", error);
      res.status(500).json({ error: "Server error", details: error.message });
    }
  }
);

// Health check route
app.get("/api/health", (req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date(),
    version: "1.0.0",
  });
});

// ==================== ARTICLE ROUTES - COMPLETE FIX ====================

// Helper function to categorize articles intelligently
function categorizeArticle(text) {
  if (!text) return "General Legal";

  const lowerText = text.toLowerCase();

  const categories = [
    {
      name: "Criminal Law",
      keywords: [
        "criminal",
        "crime",
        "murder",
        "theft",
        "penal",
        "robbery",
        "assault",
        "arrest",
        "fir",
      ],
    },
    {
      name: "Civil Law",
      keywords: [
        "civil",
        "contract",
        "property",
        "tort",
        "damages",
        "suit",
        "plaintiff",
        "defendant",
      ],
    },
    {
      name: "Tax Law",
      keywords: [
        "tax",
        "revenue",
        "customs",
        "duty",
        "income tax",
        "sales tax",
        "fbr",
      ],
    },
    {
      name: "Family Law",
      keywords: [
        "family",
        "divorce",
        "marriage",
        "custody",
        "talaq",
        "khula",
        "nikah",
        "maintenance",
      ],
    },
    {
      name: "Corporate Law",
      keywords: [
        "corporate",
        "company",
        "business",
        "partnership",
        "secp",
        "shares",
        "director",
      ],
    },
    {
      name: "Constitutional Law",
      keywords: [
        "constitutional",
        "supreme court",
        "high court",
        "fundamental rights",
        "article",
        "constitution",
      ],
    },
  ];

  for (const category of categories) {
    if (category.keywords.some((keyword) => lowerText.includes(keyword))) {
      return category.name;
    }
  }

  return "General Legal";
}

// GET all articles (Database + NewsAPI combined)
app.get("/api/articles", async (req, res) => {
  try {
    const { category, search, page = 1, limit = 12 } = req.query;

    console.log(
      "📰 Fetching articles - Category:",
      category,
      "Search:",
      search,
      "Page:",
      page
    );

    // Build query for custom database articles
    let dbQuery = { isActive: true };

    if (category && category !== "All") {
      dbQuery.category = category;
    }

    if (search) {
      dbQuery.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
      ];
    }

    // Fetch custom articles from database
    const customArticles = await Article.find(dbQuery)
      .sort({ publishedAt: -1 })
      .limit(parseInt(limit) / 2); // Get half from DB

    console.log("✅ Database articles fetched:", customArticles.length);

    // Fetch from NewsAPI
    let newsArticles = [];
    const NEWS_API_KEY =
      process.env.NEWS_API_KEY || "a54056c2a69e4ebebf5cb386326dced7";

    try {
      const searchQuery =
        search ||
        (category && category !== "All"
          ? `Pakistan ${category}`
          : "Pakistan Law");

      const newsResponse = await axios.get(
        "https://newsapi.org/v2/everything",
        {
          params: {
            q: searchQuery,
            language: "en",
            sortBy: "publishedAt",
            page: parseInt(page),
            pageSize: Math.ceil(parseInt(limit) / 2), // Get half from NewsAPI
            apiKey: NEWS_API_KEY,
          },
          timeout: 10000, // 10 second timeout
        }
      );

      if (newsResponse.data && newsResponse.data.articles) {
        newsArticles = newsResponse.data.articles
          .filter((article) => article.title && article.description) // Filter out incomplete articles
          .map((article, index) => ({
            _id: `news-${Date.now()}-${index}`,
            id: `news-${Date.now()}-${index}`,
            title: article.title,
            description:
              article.description || "Read the full article for more details",
            content:
              article.content ||
              article.description ||
              "Full content available at source website",
            image:
              article.urlToImage ||
              "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800",
            source: article.source?.name || "News Source",
            author: article.author || "Staff Reporter",
            publishedAt: article.publishedAt || new Date().toISOString(),
            url: article.url,
            category: categorizeArticle(
              article.title + " " + article.description
            ),
            isExternal: true,
            isActive: true,
            views: 0,
          }));

        console.log("✅ NewsAPI articles fetched:", newsArticles.length);
      }
    } catch (newsError) {
      console.error("⚠️ NewsAPI error (non-critical):", newsError.message);
      // Continue even if NewsAPI fails - we'll show DB articles
    }

    // Combine and sort all articles by date
    const allArticles = [...customArticles, ...newsArticles]
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, parseInt(limit)); // Final limit

    console.log("✅ Total articles returned:", allArticles.length);

    res.json(allArticles);
  } catch (error) {
    console.error("❌ Error fetching articles:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching articles",
      error: error.message,
    });
  }
});

// GET single article by ID
app.get("/api/articles/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log("📄 Fetching article ID:", id);

    // Check if it's a NewsAPI article
    if (id.startsWith("news-")) {
      return res.status(404).json({
        success: false,
        message: "External article - please view on source website",
        isExternal: true,
      });
    }

    // Find custom article in database
    const article = await Article.findById(id);

    if (!article || !article.isActive) {
      return res.status(404).json({
        success: false,
        message: "Article not found",
      });
    }

    // Increment views
    article.views = (article.views || 0) + 1;
    await article.save();

    console.log("✅ Article found:", article.title);

    res.json(article);
  } catch (error) {
    console.error("❌ Error fetching article:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching article",
      error: error.message,
    });
  }
});

// Search articles
app.get("/api/articles/search", async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query required",
      });
    }

    const articles = await Article.find({
      isActive: true,
      $or: [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } },
      ],
    }).sort({ publishedAt: -1 });

    res.json(articles);
  } catch (error) {
    console.error("Error searching articles:", error);
    res.status(500).json({
      success: false,
      message: "Error searching articles",
      error: error.message,
    });
  }
});

// CREATE new article (Admin only)
app.post("/api/articles", authMiddleware, async (req, res) => {
  try {
    const {
      title,
      description,
      content,
      introduction,
      image,
      source,
      author,
      category,
      publishedAt,
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required",
      });
    }

    const newArticle = new Article({
      title,
      description: description || title,
      content,
      introduction: introduction || description,
      image:
        image ||
        "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800",
      source: source || "Voice of Law Editorial",
      author: author || req.user.name || "Legal Team",
      category: category || "General Legal",
      publishedAt: publishedAt || new Date(),
      isActive: true,
      views: 0,
      isExternal: false,
    });

    await newArticle.save();

    console.log("✅ Article created:", newArticle.title);

    res.status(201).json({
      success: true,
      message: "Article created successfully",
      data: newArticle,
    });
  } catch (error) {
    console.error("❌ Error creating article:", error.message);
    res.status(500).json({
      success: false,
      message: "Error creating article",
      error: error.message,
    });
  }
});

// UPDATE article (Admin only)
app.put("/api/articles/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const article = await Article.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!article) {
      return res.status(404).json({
        success: false,
        message: "Article not found",
      });
    }

    console.log("✅ Article updated:", article.title);

    res.json({
      success: true,
      message: "Article updated successfully",
      data: article,
    });
  } catch (error) {
    console.error("❌ Error updating article:", error.message);
    res.status(500).json({
      success: false,
      message: "Error updating article",
      error: error.message,
    });
  }
});

// DELETE article (Admin only)
app.delete("/api/articles/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const article = await Article.findByIdAndDelete(id);

    if (!article) {
      return res.status(404).json({
        success: false,
        message: "Article not found",
      });
    }

    console.log("✅ Article deleted:", article.title);

    res.json({
      success: true,
      message: "Article deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting article:", error.message);
    res.status(500).json({
      success: false,
      message: "Error deleting article",
      error: error.message,
    });
  }
});

// SEED sample articles (run once on startup)
async function seedArticles() {
  try {
    const count = await Article.countDocuments();
    if (count > 0) {
      console.log("Articles already exist, skipping seed");
      return;
    }

    const sampleArticles = [
      {
        title: "Understanding Constitutional Rights in Pakistan",
        description:
          "A comprehensive guide to fundamental rights enshrined in the Constitution of Pakistan",
        content: `The Constitution of Pakistan, 1973, guarantees fundamental rights to all citizens. Article 8 to Article 28 of the Constitution deal with Fundamental Rights. These rights are enforceable through the Superior Courts of Pakistan.

Key Fundamental Rights include:

1. Security of Person (Article 9)
No person shall be deprived of life or liberty save in accordance with law.

2. Right to Fair Trial (Article 10A)
For the determination of his civil rights and obligations or in any criminal charge against him a person shall be entitled to a fair trial and due process.

3. Freedom of Speech (Article 19)
Every citizen shall have the right to freedom of speech and expression, subject to any reasonable restrictions imposed by law.

4. Freedom of Assembly (Article 17)
Every citizen shall have the right to form associations or unions, subject to any reasonable restrictions imposed by law.

5. Right to Property (Article 23)
Every citizen shall have the right to acquire, hold and dispose of property in any part of Pakistan.

The Supreme Court of Pakistan and the High Courts have the power to enforce these fundamental rights through writs under Article 184(3) and Article 199 of the Constitution respectively.`,
        image:
          "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800",
        category: "Constitutional Law",
        author: "Legal Team",
        source: "Voice of Law Review",
      },
      {
        title: "Criminal Procedure Code: A Complete Overview",
        description:
          "Understanding the procedural aspects of criminal law in Pakistan",
        content: `The Code of Criminal Procedure, 1898 (CrPC) is the primary law regulating the procedural aspects of criminal law in Pakistan. It provides the machinery for the investigation of crime, apprehension of suspected criminals, collection of evidence, determination of guilt or innocence of the accused person and the determination of punishment of the guilty.

Key Provisions:

1. FIR (First Information Report) - Section 154
The police must record information about cognizable offences. This is the first step in criminal proceedings.

2. Investigation - Sections 156-176
Police have the power to investigate cognizable offences without magisterial order.

3. Arrest - Sections 54-60
Police can arrest without warrant in cognizable cases. Constitutional rights must be observed.

4. Bail - Sections 496-498
Bail can be granted in bailable offences as a matter of right. In non-bailable offences, it's at the court's discretion.

5. Trial - Sections 238-265
Different procedures for different types of cases: warrant cases, summons cases, sessions trials.

6. Appeals and Revisions - Sections 417-435
Provides for appeals against convictions and sentences.

Important Case Laws:
- PLD 1994 SC 133 (Zaheer-ud-Din v. State)
- PLD 1992 SC 646 (Benazir Bhutto v. Federation)`,
        image:
          "https://images.unsplash.com/photo-1505664194779-8beaceb93744?w=800",
        category: "Criminal Law",
        author: "Legal Team",
        source: "Voice of Law Review",
      },
      {
        title: "Tax Law Reforms in Pakistan 2024",
        description:
          "Recent amendments and their impact on businesses and individuals",
        content: `The Finance Act 2024 has introduced significant changes to Pakistan's tax regime, affecting both individuals and businesses.

Key Changes:

1. Income Tax Rates
- Revised tax slabs for salaried individuals
- New rates for Association of Persons (AOPs)
- Changes in corporate tax rates

2. Sales Tax Amendments
- Introduction of point-of-sale integration requirements
- Changes in input tax credit rules
- New compliance requirements for retailers

3. Withholding Tax
- Revised withholding tax rates on various transactions
- New withholding requirements for digital services
- Changes in advance tax regime

4. Tax Credits and Incentives
- Enhanced tax credits for R&D activities
- New incentives for IT and IT-enabled services
- Special economic zones benefits

5. Compliance Requirements
- Mandatory e-filing for all taxpayers
- Enhanced documentation requirements
- New audit and assessment procedures

Impact on Businesses:
- Increased compliance burden
- Need for system upgrades
- Training requirements for accounting staff

Recommendations:
- Early planning for tax compliance
- Regular consultation with tax advisors
- Investment in accounting software`,
        image:
          "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800",
        category: "Tax Law",
        author: "Tax Law Team",
        source: "Voice of Law Review",
      },
    ];

    await Article.insertMany(sampleArticles);
    console.log("✅ Sample articles seeded successfully");
  } catch (error) {
    console.error("Error seeding articles:", error);
  }
}

// ============================================
// PROTECTED ROUTES WITH SUBSCRIPTION CHECK (Example)
// ============================================

// Example: Protected dashboard route
app.get("/api/dashboard", authMiddleware, checkSubscription, (req, res) => {
  res.json({
    message: "Welcome to your dashboard!",
    subscription: req.userSubscription,
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: "File too large. Maximum size is 50MB." });
    }
  }

  res.status(500).json({ message: error.message || "Internal server error" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Create Admin User
async function createAdminUser() {
  try {
    const adminEmail = "admin@example.com";
    const adminPassword = "password123";

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);
      const adminUser = new User({
        name: "Admin User",
        email: adminEmail,
        password: hashedPassword,
        isPaid: true,
        isSubscribed: true,
        subscriptionStatus: "active",
        role: "admin",
        subscriptionStartDate: new Date(),
        subscriptionEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      });
      await adminUser.save();
      console.log("Admin user created successfully! 🎉");
      console.log("Email: admin@example.com");
      console.log("Password: password123");
    } else {
      console.log("Admin user already exists.");
    }
  } catch (error) {
    console.error("Error creating admin user:", error);
  }
}

// Initialize default data
async function initializeDefaultData() {
  try {
    // Check if we need to create default more about cards
    const cardCount = await MoreAboutCard.countDocuments();
    if (cardCount === 0) {
      const defaultCards = [
        {
          category: "Law",
          image: "/uploads/default-1.jpg",
          date: "April 09, 2025",
          title: "Understanding Constitutional Law",
          description:
            "A comprehensive guide to constitutional principles and their applications in modern legal practice.",
          isLocked: false,
        },
        {
          category: "Cases",
          image: "/uploads/default-2.jpg",
          date: "April 10, 2025",
          title: "Landmark Supreme Court Cases",
          description:
            "Analysis of pivotal cases that shaped modern jurisprudence and legal precedents.",
          isLocked: true,
        },
      ];

      await MoreAboutCard.insertMany(defaultCards);
      console.log("Default more about cards created");
    }

    // Check if we need to create default latest updates
    const updateCount = await LatestUpdate.countDocuments();
    if (updateCount === 0) {
      const defaultUpdates = [
        {
          title: "New AI Legal Research Feature",
          summary: "Enhanced case law research with AI-powered insights",
          details:
            "Our new AI research tool can analyze thousands of cases in seconds, providing you with relevant precedents and legal arguments.",
          date: "2 days ago",
          type: "Feature",
          image: "/uploads/default-3.jpg",
          gradient: "linear-gradient(135deg, #454444 0%, #c79f44 100%)",
        },
        {
          title: "Security Enhancement Update",
          summary: "Advanced encryption for document protection",
          details:
            "We have implemented military-grade encryption to ensure your sensitive legal documents are protected at all times.",
          date: "5 days ago",
          type: "Security",
          image: "/uploads/default-4.jpg",
          gradient: "linear-gradient(135deg, #3b3b3b 0%, #c79f44 100%)",
        },
      ];

      await LatestUpdate.insertMany(defaultUpdates);
      console.log("Default latest updates created");
    }

    // Check if we need to create default announcements
    const announcementCount = await Announcement.countDocuments();
    if (announcementCount === 0) {
      const defaultAnnouncements = [
        {
          date: "16-MAY-2025",
          type: "Tender",
          title:
            "Islamabad High Court Islamabad invites electronic bids through PPPRA EPPADS portal as per Rule-2004, Rule 3(a), (Single Stage on...",
          link: "#",
          category: "TENDERS",
          priority: "high",
        },
        {
          date: "24-FEB-2025",
          type: "Notification",
          title:
            "New court procedures for digital document submission now in effect",
          link: "#",
          category: "NOTIFICATIONS",
          priority: "medium",
        },
      ];

      await Announcement.insertMany(defaultAnnouncements);
      console.log("Default announcements created");
    }

    // Check if we need to create default books
    const bookCount = await Book.countDocuments();
    if (bookCount === 0) {
      const defaultBooks = [
        {
          title: "Constitutional Law of Pakistan",
          description:
            "Comprehensive guide to the constitutional framework of Pakistan",
          category: "Books",
          image: "/uploads/default-book-1.jpg",
          pdfFile: "/uploads/default-pdf-1.pdf",
          author: "Legal Experts",
          fileSize: "2.5 MB",
          downloads: 0,
        },
        {
          title: "Criminal Procedure Code",
          description:
            "Detailed analysis of criminal procedures and court processes",
          category: "Acts & Rules",
          image: "/uploads/default-book-2.jpg",
          pdfFile: "/uploads/default-pdf-2.pdf",
          author: "Justice Department",
          fileSize: "3.1 MB",
          downloads: 0,
        },
      ];

      await Book.insertMany(defaultBooks);
      console.log("Default books created");
    }

    // Check if we need to create default standalone notes
    const noteCount = await StandaloneNote.countDocuments();
    if (noteCount === 0) {
      const defaultNotes = [
        {
          title: "Welcome to Voice of Law",
          content:
            "This is your first note. You can create, edit, and delete notes here.",
          date: new Date().toLocaleString(),
          createdBy: null, // Will be set when a user creates it
        },
      ];

      await StandaloneNote.insertMany(defaultNotes);
      console.log("Default standalone notes created");
    }
  } catch (error) {
    console.error("Error initializing default data:", error);
  }
}

// ============================================
// 7. ENSURE DEFAULT DATA EXISTS
// ============================================
async function ensureDefaultData() {
  try {
    // Check if we have any data
    const cardCount = await MoreAboutCard.countDocuments();
    const updateCount = await LatestUpdate.countDocuments();
    const announcementCount = await Announcement.countDocuments();
    const bookCount = await Book.countDocuments();

    console.log("📊 Current data counts:", {
      cards: cardCount,
      updates: updateCount,
      announcements: announcementCount,
      books: bookCount,
    });

    // If no data exists, create sample data
    if (cardCount === 0 && updateCount === 0 && announcementCount === 0) {
      console.log("⚠️ No data found. Creating sample data...");
      await initializeDefaultData();
    } else {
      console.log("✅ Data exists. Skipping initialization.");
    }
  } catch (error) {
    console.error("Error checking data:", error);
  }
}

// Call this on server start
ensureDefaultData();

console.log("✅ All admin panel routes fixed and active");

createAdminUser();
initializeDefaultData();
seedArticles();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Combined Server is running on http://localhost:${PORT}`);
  console.log(`📁 Upload directories created`);
  console.log(`📚 Book management system integrated`);
  console.log(`📝 Standalone notes system integrated`);
  console.log(`💳 Enhanced subscription system integrated`);
  console.log(`👤 Admin Login: admin@example.com / password123`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
});

module.exports = app;
