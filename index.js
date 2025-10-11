// index.js - Combined Backend Server
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dotenv = require('dotenv');

// Ollama related imports
const { Ollama } = require("@langchain/community/llms/ollama");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { OllamaEmbeddings } = require("@langchain/community/embeddings/ollama");
const { RetrievalQAChain } = require("langchain/chains");
const { PromptTemplate } = require("@langchain/core/prompts");
const pdf = require("pdf-parse");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const pdfParse = require("pdf-parse");
const fs = require("fs").promises;
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const STRIPE_SECRET = process.env.STRIPE_SECRET;

const stripe = Stripe(STRIPE_SECRET);

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/voiceoflaw")
  .then(() => console.log("Connected to MongoDB 🚀"))
  .catch(err => console.error("Could not connect to MongoDB:", err));

// --- Enhanced Mongoose Schemas ---

// User Schema (Enhanced)
const UserSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin", "user"], default: "user" },
  isPaid: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

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
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now }
});

// Note Schema (Notes Management)
const NoteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Enhanced Case Management Schema
const CaseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  caseNo: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'hearing'],
    default: 'pending'
  },
  court: {
    type: String,
    required: true
  },
  nextHearing: {
    type: Date,
    required: true
  },
  partyName: {
    type: String,
    required: true
  },
  respondent: {
    type: String,
    required: true
  },
  lawyer: {
    type: String,
    required: true
  },
  contactNumber: {
    type: String,
    required: true
  },
  advocateContactNumber: {
    type: String
  },
  adversePartyAdvocateName: {
    type: String
  },
  caseYear: {
    type: Number,
    required: true
  },
  onBehalfOf: {
    type: String,
    required: true,
    enum: ['Petitioner', 'Respondent', 'Complainant', 'Accused', 'Plantiff', 'DHR', 'JDR', 'Appellant']
  },
  description: {
    type: String
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  
  // File attachments for different sections (Enhanced)
  drafts: [{ 
    type: { type: String, enum: ['file', 'note'], required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
    name: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }],
  
  opponentDrafts: [{ 
    type: { type: String, enum: ['file', 'note'], required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
    name: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }],
  
  courtOrders: [{ 
    type: { type: String, enum: ['file', 'note'], required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
    name: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }],
  
  evidence: [{ 
    type: { type: String, enum: ['file', 'note'], required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
    name: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }],
  
  relevantSections: [{ 
    type: { type: String, enum: ['file', 'note'], required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' },
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
    name: { type: String, required: true },
    addedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY");

// Conversation Schema
const ConversationSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  title: { 
    type: String, 
    default: 'New Conversation' 
  },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    sources: [{ type: String }]
  }],
  isBookmarked: { 
    type: Boolean, 
    default: false 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

const Conversation = mongoose.model('Conversation', ConversationSchema);

// Language Detection
function detectLanguage(text) {
  const urduPattern = /[\u0600-\u06FF]/;
  if (urduPattern.test(text)) return 'urdu';
  
  const romanUrduKeywords = ['kya', 'hai', 'aur', 'ko', 'ka', 'ki', 'main', 'mein', 'hoon', 'kaise', 'kyun', 'kab', 'kahan'];
  const lowerText = text.toLowerCase();
  const romanUrduCount = romanUrduKeywords.filter(keyword => lowerText.includes(keyword)).length;
  
  if (romanUrduCount >= 2) return 'roman_urdu';
  return 'english';
}

// Check if query is law-related
function isLawRelated(text) {
  const legalKeywords = [
    'law', 'legal', 'court', 'judge', 'case', 'attorney', 'lawyer', 'advocate',
    'constitution', 'act', 'section', 'article', 'petition', 'appeal', 'defendant',
    'plaintiff', 'prosecution', 'defense', 'bail', 'verdict', 'judgment', 'statute',
    'regulation', 'ordinance', 'contract', 'agreement', 'property', 'criminal',
    'civil', 'family', 'divorce', 'custody', 'inheritance', 'murder', 'theft',
    'fraud', 'corruption', 'rights', 'duty', 'obligation', 'liability', 'damages',
    // Urdu/Roman Urdu keywords
    'qanoon', 'adalat', 'judge', 'wakeel', 'muqadma', 'fauj-dari', 'diwani',
    'shadi', 'talaq', 'tarka', 'jائیداد', 'huqooq', 'farz', 'zimmedari'
  ];
  
  const lowerText = text.toLowerCase();
  return legalKeywords.some(keyword => lowerText.includes(keyword));
}

// Extract text from PDF
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
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
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { type: { $regex: query, $options: 'i' } }
      ]
    }).limit(5);
    
    for (const caseItem of cases) {
      results.push({
        type: 'case',
        title: caseItem.title,
        content: `Case No: ${caseItem.caseNo}, Type: ${caseItem.type}, Status: ${caseItem.status}, Description: ${caseItem.description || 'N/A'}`,
        source: `Case: ${caseItem.title}`
      });
    }
    
    // Search in books
    const books = await Book.find({
      isActive: true,
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } }
      ]
    }).limit(3);
    
    for (const book of books) {
      // Try to extract text from PDF
      const pdfPath = path.join(__dirname, book.pdfFile);
      let pdfText = '';
      try {
        if (await fs.access(pdfPath).then(() => true).catch(() => false)) {
          pdfText = await extractTextFromPDF(pdfPath);
        }
      } catch (err) {
        console.log('Could not read PDF:', book.title);
      }
      
      results.push({
        type: 'book',
        title: book.title,
        content: `${book.description}\n\n${pdfText.substring(0, 2000)}`,
        source: `Book: ${book.title} (${book.category})`
      });
    }
    
    // Search in blog posts
    const posts = await Post.find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { fullContent: { $regex: query, $options: 'i' } }
      ]
    }).limit(3);
    
    for (const post of posts) {
      results.push({
        type: 'article',
        title: post.title,
        content: post.fullContent || post.description,
        source: `Article: ${post.title}`
      });
    }
    
    return results;
  } catch (error) {
    console.error('Database search error:', error);
    return [];
  }
}

// Generate AI response using Gemini
async function generateAIResponse(query, language, context, isLawQuery) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    let systemPrompt = '';
    
    if (language === 'urdu') {
      systemPrompt = `آپ ایک پاکستانی قانونی معاون ہیں۔ صرف قانونی سوالات کا جواب دیں۔ اگر سوال قانون سے متعلق نہیں ہے، تو شائستگی سے انکار کریں۔`;
    } else if (language === 'roman_urdu') {
      systemPrompt = `Aap ek Pakistani legal assistant hain. Sirf legal sawalat ka jawab dein Roman Urdu mein. Agar sawal law se related nahi hai, to shayasta tareeqe se inkaar karein.`;
    } else {
      systemPrompt = `You are a Pakistani legal assistant. Only answer law-related questions in English. If the question is not related to law, politely decline.`;
    }
    
    if (!isLawQuery) {
      if (language === 'urdu') {
        return {
          response: 'معذرت، میں صرف قانونی معاملات میں مدد کر سکتا ہوں۔ براہ کرم کوئی قانونی سوال پوچھیں۔',
          sources: []
        };
      } else if (language === 'roman_urdu') {
        return {
          response: 'Maazrat, main sirf legal matters mein madad kar sakta hoon. Koi legal sawal poochain.',
          sources: []
        };
      } else {
        return {
          response: 'I can only provide assistance related to law and legal cases. Please ask a legal question.',
          sources: []
        };
      }
    }
    
    let contextText = '';
    const sources = [];
    
    if (context && context.length > 0) {
      contextText = '\n\nRelevant information from database:\n';
      context.forEach((item, index) => {
        contextText += `\n[${index + 1}] ${item.title}\n${item.content.substring(0, 500)}...\n`;
        sources.push(item.source);
      });
    }
    
    const prompt = `${systemPrompt}\n\nUser Query: ${query}\n${contextText}\n\nProvide a detailed, professional legal answer based on Pakistani law. If database context is provided, use it primarily. Otherwise, use your general legal knowledge about Pakistan.`;
    
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    return { response, sources };
  } catch (error) {
    console.error('AI generation error:', error);
    
    if (language === 'urdu') {
      return {
        response: 'معذرت، اس وقت جواب دینے میں مسئلہ ہو رہا ہے۔ براہ کرم دوبارہ کوشش کریں۔',
        sources: []
      };
    } else if (language === 'roman_urdu') {
      return {
        response: 'Maazrat, is waqt jawab dene mein masla ho raha hai. Dobara koshish karein.',
        sources: []
      };
    } else {
      return {
        response: 'Sorry, I\'m having trouble processing your request right now. Please try again.',
        sources: []
      };
    }
  }
}

// ==================== API ENDPOINTS ====================

// Get all conversations for user
app.get('/api/chatbot/conversations', authMiddleware, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.id })
      .sort({ updatedAt: -1 })
      .select('title messages isBookmarked createdAt updatedAt');
    
    const formatted = conversations.map(conv => ({
      id: conv._id,
      title: conv.title,
      preview: conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].content.substring(0, 100) : '',
      date: getRelativeTime(conv.updatedAt),
      messages: conv.messages.length,
      isBookmarked: conv.isBookmarked
    }));
    
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching conversations', error: error.message });
  }
});

// Get single conversation
app.get('/api/chatbot/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching conversation', error: error.message });
  }
});

// Create new conversation
app.post('/api/chatbot/conversations', authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;
    
    const conversation = new Conversation({
      userId: req.user.id,
      title: title || 'New Conversation',
      messages: []
    });
    
    await conversation.save();
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ message: 'Error creating conversation', error: error.message });
  }
});

// Send message and get AI response
app.post('/api/chatbot/chat', authMiddleware, async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }
    
    // Detect language and check if law-related
    const language = detectLanguage(message);
    const isLawQuery = isLawRelated(message);
    
    // Search in database first
    const dbResults = await searchInDatabase(message, req.user.id);
    
    // Generate AI response
    const { response, sources } = await generateAIResponse(
      message,
      language,
      dbResults,
      isLawQuery
    );
    
    // Find or create conversation
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        userId: req.user.id
      });
    }
    
    if (!conversation) {
      conversation = new Conversation({
        userId: req.user.id,
        title: message.substring(0, 50),
        messages: []
      });
    }
    
    // Add messages
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    });
    
    conversation.messages.push({
      role: 'assistant',
      content: response,
      timestamp: new Date(),
      sources: sources
    });
    
    conversation.updatedAt = new Date();
    await conversation.save();
    
    res.json({
      response,
      conversationId: conversation._id,
      sources,
      isLawRelated: isLawQuery,
      language
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      message: 'Error processing chat', 
      error: error.message 
    });
  }
});

// Delete conversation
app.delete('/api/chatbot/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting conversation', error: error.message });
  }
});

// Toggle bookmark
app.patch('/api/chatbot/conversations/:id/bookmark', authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    conversation.isBookmarked = !conversation.isBookmarked;
    await conversation.save();
    
    res.json({ isBookmarked: conversation.isBookmarked });
  } catch (error) {
    res.status(500).json({ message: 'Error updating bookmark', error: error.message });
  }
});

// Helper function for relative time
function getRelativeTime(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return `${Math.floor(seconds / 604800)} weeks ago`;
}

module.exports = { Conversation };


// New Schemas for Additional Features
const MoreAboutCardSchema = new mongoose.Schema({
  category: { type: String, required: true },
  image: { type: String, required: true },
  date: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  isLocked: { type: Boolean, default: false }
});

const LatestUpdateSchema = new mongoose.Schema({
  title: { type: String, required: true },
  summary: { type: String, required: true },
  details: { type: String, required: true },
  date: { type: String, required: true },
  type: { type: String, required: true },
  image: { type: String, required: true },
  gradient: { type: String, default: 'linear-gradient(135deg, #454444 0%, #c79f44 100%)' }
});

const AnnouncementSchema = new mongoose.Schema({
  date: { type: String, required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  link: { type: String, default: '#' },
  category: { type: String, required: true },
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' }
});

// ==================== BOOK SCHEMA ====================
const BookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Books', 'Case Laws / Judgements', 'Acts & Rules', 'Research Papers / Articles']
  },
  image: {
    type: String,
    required: true
  },
  pdfFile: {
    type: String,
    required: true
  },
  author: {
    type: String,
    default: ''
  },
  publishedDate: {
    type: Date,
    default: Date.now
  },
  fileSize: {
    type: String,
    default: ''
  },
  downloads: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// ==================== STANDALONE NOTE SCHEMA ====================
const StandaloneNoteSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  date: {
    type: String,
    required: true
  },
  // NEW: Link to user who created the note
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Mongoose Models
const User = mongoose.model('User', UserSchema);
const Post = mongoose.model('Post', PostSchema);
const Case = mongoose.model('Case', CaseSchema);
const File = mongoose.model('File', FileSchema);
const Note = mongoose.model('Note', NoteSchema);
const MoreAboutCard = mongoose.model('MoreAboutCard', MoreAboutCardSchema);
const LatestUpdate = mongoose.model('LatestUpdate', LatestUpdateSchema);
const Announcement = mongoose.model('Announcement', AnnouncementSchema);
const Book = mongoose.model('Book', BookSchema);
const StandaloneNote = mongoose.model('StandaloneNote', StandaloneNoteSchema);

// Create uploads directories
const createUploadsDir = () => {
  const dirs = [
    'uploads/cases', 
    'uploads/drafts', 
    'uploads/evidence', 
    'uploads/court-orders',
    'uploads/more-about-cards',
    'uploads/latest-updates',
    'uploads/books',
    'uploads/book-images'
  ];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};
createUploadsDir();

// --- Middleware ---
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
}));

// Webhook endpoint (must be raw body, so yeh express.json() se pehle aata hai)
app.post("/api/pay/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
          await user.save();
          console.log(`User ${userId} marked as paid.`);
        }
      }
    } catch (error) {
      console.error("Error updating user payment status:", error);
      return res.status(500).json({ message: "Server error updating payment status." });
    }
  }

  res.json({ received: true });
});

// Regular JSON middleware for other routes
app.use(express.json());

// NEW, MORE EXPLICIT STATIC ROUTES
const uploadsDir = path.join(__dirname, 'uploads');
app.use('/uploads/more-about-cards', express.static(path.join(uploadsDir, 'more-about-cards')));
app.use('/uploads/latest-updates', express.static(path.join(uploadsDir, 'latest-updates')));
app.use('/uploads/drafts', express.static(path.join(uploadsDir, 'drafts')));
app.use('/uploads/evidence', express.static(path.join(uploadsDir, 'evidence')));
app.use('/uploads/court-orders', express.static(path.join(uploadsDir, 'court-orders')));
app.use('/uploads/cases', express.static(path.join(uploadsDir, 'cases')));
app.use('/uploads/books', express.static(path.join(uploadsDir, 'books')));
app.use('/uploads/book-images', express.static(path.join(uploadsDir, 'book-images')));

app.get('/test-uploads', (req, res) => {
  const uploadsPath = path.join(__dirname, 'uploads');
  res.json({
    uploadsPath: uploadsPath,
    exists: fs.existsSync(uploadsPath),
    files: fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath) : []
  });
});

// --- Authentication Middleware ---
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/cases'; // The default path

    // FIX: Check the API route to determine the correct upload folder
    if (req.originalUrl.includes('/api/more-about-cards')) {
      uploadPath = 'uploads/more-about-cards';
    } else if (req.originalUrl.includes('/api/latest-updates')) {
      uploadPath = 'uploads/latest-updates';
    } else if (req.originalUrl.includes('/api/books')) {
      if (file.fieldname === 'image') {
        uploadPath = 'uploads/book-images';
      } else if (file.fieldname === 'pdfFile') {
        uploadPath = 'uploads/books';
      }
    } else if (req.originalUrl.includes('/api/cases')) {
      // This is the existing logic for case-specific uploads, which is correct
      const { sectionType } = req.body;
      switch(sectionType) {
        case 'drafts':
        case 'opponentDrafts':
          uploadPath = 'uploads/drafts';
          break;
        case 'evidence':
          uploadPath = 'uploads/evidence';
          break;
        case 'courtOrders':
          uploadPath = 'uploads/court-orders';
          break;
        default:
          uploadPath = 'uploads/cases';
      }
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only images and PDF files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for books, 10MB for others
  }
});

// Special upload for books (both image and PDF)
const uploadBook = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'image') {
        cb(null, 'uploads/book-images');
      } else if (file.fieldname === 'pdfFile') {
        cb(null, 'uploads/books');
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const prefix = file.fieldname === 'image' ? 'book-image-' : 'book-';
      cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.fieldname === 'pdfFile' && file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type!'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ==================== HELPER FUNCTIONS ====================
const getFileSize = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;
    const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
    return `${fileSizeInMB} MB`;
  } catch (error) {
    return 'Unknown';
  }
};

const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

// --- API Endpoints ---

// Auth Routes
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }
    user = new User({ name, email, password, isPaid: false });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();
    
    const payload = { 
      user: { 
        id: user.id, 
        name: user.name,
        email: user.email, 
        role: user.role, 
        isPaid: user.isPaid 
      } 
    };
    
    jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
      if (err) throw err;
      res.json({ 
        token, 
        user: payload.user,
        message: 'User registered successfully'
      });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid Credentials" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Credentials" });
    }
    
    const payload = { 
      user: { 
        id: user.id, 
        name: user.name,
        email: user.email, 
        role: user.role, 
        isPaid: user.isPaid 
      } 
    };
    
    jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
      if (err) throw err;
      res.json({ 
        token, 
        user: payload.user,
        message: 'Login successful'
      });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Payment Routes
app.post("/api/pay/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Voice of Law - $2 Access" },
          unit_amount: 200,
        },
        quantity: 1,
      }],
      success_url: process.env.CLIENT_URL + "/auth/login?payment_status=success",
      cancel_url: process.env.CLIENT_URL + "/auth/login?payment_status=canceled",
      metadata: {
        userId: req.user.id,
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Profile Route
app.get('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// Blog Content Routes
app.get('/api/blog-data', async (req, res) => {
  try {
    const posts = await Post.find({});
    const categories = [...new Set(posts.map(p => p.category).filter(c => c))];
    const tags = ['Law-Tech', 'Updates', 'Pakistan', 'Legal'];
    const pickedCards = posts.filter(p => p.type === 'picked');
    const latestPosts = posts.filter(p => p.type === 'latest');
    const featuredPosts = posts.filter(p => p.type === 'featured');

    res.json({ categories, tags, pickedCards, latestPosts, featuredPosts });
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.get('/api/posts/:id', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).send('Post not found');
    }

    const user = await User.findById(req.user.id);
    if (!user || (!user.isPaid && user.role !== 'admin')) {
      return res.status(403).json({ message: 'Subscription required to view full content' });
    }
    res.json(post);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// Ollama Legal Question Endpoint
app.post('/api/legal-question', authMiddleware, async (req, res) => {
  const { message } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user || (!user.isPaid && user.role !== 'admin')) {
      return res.status(403).json({ response: 'Please subscribe to use the legal assistance feature.' });
    }

    const ollamaLlm = new Ollama({ model: "llama2" });
    const vectorStore = new MemoryVectorStore();
    const promptTemplate = new PromptTemplate({
      template: `You are a legal assistant. Answer the user's question based on the context provided.
      Context: {context}
      Question: {query}
      Answer:`,
      inputVariables: ["context", "query"]
    });

    const chain = RetrievalQAChain.fromLLM(ollamaLlm, vectorStore.asRetriever(2), { prompt: promptTemplate });
    const response = await chain.call({ query: message });
    res.json({ response: response.text, success: true });
  } catch (error) {
    console.error("⌐ Error:", error);
    res.status(500).json({ response: "I'm having trouble processing your request. Please try again.", success: false });
  }
});

// --- Enhanced Case Management Routes ---

// Get all cases for authenticated user
app.get('/api/cases', authMiddleware, async (req, res) => {
  try {
    const cases = await Case.find({ userId: req.user.id })
      .populate('drafts.fileId')
      .populate('drafts.noteId')
      .populate('opponentDrafts.fileId')
      .populate('opponentDrafts.noteId')
      .populate('courtOrders.fileId')
      .populate('courtOrders.noteId')
      .populate('evidence.fileId')
      .populate('evidence.noteId')
      .populate('relevantSections.fileId')
      .populate('relevantSections.noteId')
      .sort({ createdAt: -1 });
    
    res.json(cases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single case
app.get('/api/cases/:id', authMiddleware, async (req, res) => {
  try {
    const caseItem = await Case.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    })
    .populate({
      path: 'drafts.fileId',
      model: 'File'
    })
    .populate({
      path: 'drafts.noteId', 
      model: 'Note'
    })
    .populate({
      path: 'opponentDrafts.fileId',
      model: 'File'
    })
    .populate({
      path: 'opponentDrafts.noteId',
      model: 'Note'
    })
    .populate({
      path: 'courtOrders.fileId',
      model: 'File'
    })
    .populate({
      path: 'courtOrders.noteId',
      model: 'Note'
    })
    .populate({
      path: 'evidence.fileId',
      model: 'File'
    })
    .populate({
      path: 'evidence.noteId',
      model: 'Note'
    })
    .populate({
      path: 'relevantSections.fileId',
      model: 'File'
    })
    .populate({
      path: 'relevantSections.noteId',
      model: 'Note'
    });
    
    if (!caseItem) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json(caseItem);
  } catch (error) {
    console.error('Case fetch error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create new case
app.post('/api/cases', authMiddleware, async (req, res) => {
  try {
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
      status: req.body.status || 'pending',
      userId: req.user.id
    };
    
    const newCase = new Case(caseData);
    const savedCase = await newCase.save();
    res.status(201).json(savedCase);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Case number already exists' });
    }
    res.status(400).json({ message: error.message });
  }
});

// Update case
app.put('/api/cases/:id', authMiddleware, async (req, res) => {
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
      updatedAt: new Date()
    };

    const caseItem = await Case.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!caseItem) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json(caseItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete case
app.delete('/api/cases/:id', authMiddleware, async (req, res) => {
  try {
    const caseItem = await Case.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!caseItem) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json({ message: 'Case deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// File Upload Routes
app.post('/api/cases/:id/upload', authMiddleware, upload.array('files'), async (req, res) => {
  try {
    const { id } = req.params;
    const { sectionType } = req.body;
    
    const caseData = await Case.findOne({
      _id: id,
      userId: req.user.id
    });
    
    if (!caseData) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    const uploadedFiles = [];
    
    for (const file of req.files) {
      const fileDoc = new File({
        originalName: file.originalname,
        filename: file.filename,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size,
        uploadedBy: req.user.id
      });
      
      await fileDoc.save();
      
      const fileEntry = {
        type: 'file',
        fileId: fileDoc._id,
        name: file.originalname,
        addedAt: new Date()
      };
      
      caseData[sectionType].push(fileEntry);
      uploadedFiles.push({
        id: fileDoc._id,
        name: file.originalname,
        type: 'file',
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
        dateAdded: new Date().toISOString().split('T')[0],
        url: `/uploads/${path.relative('uploads', file.path)}`
      });
    }
    
    await caseData.save();
    
    res.json({
      message: 'Files uploaded successfully',
      files: uploadedFiles
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Note Routes for cases
app.post('/api/cases/:id/notes', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { sectionType, title, content = '' } = req.body;
    
    const caseData = await Case.findOne({
      _id: id,
      userId: req.user.id
    });
    
    if (!caseData) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    const note = new Note({
      title,
      content,
      createdBy: req.user.id
    });
    
    await note.save();
    
    const noteEntry = {
      type: 'note',
      noteId: note._id,
      name: title,
      addedAt: new Date()
    };
    
    caseData[sectionType].push(noteEntry);
    await caseData.save();
    
    res.json({
      message: 'Note created successfully',
      note: {
        id: note._id,
        name: title,
        type: 'note',
        dateAdded: new Date().toISOString().split('T')[0],
        content: content
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.put('/api/notes/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;
    
    const note = await Note.findOneAndUpdate(
      { _id: id, createdBy: req.user.id },
      { title, content, updatedAt: new Date() },
      { new: true }
    );
    
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }
    
    res.json({
      message: 'Note updated successfully',
      note
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete file/note from case
app.delete('/api/cases/:caseId/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const { caseId, itemId } = req.params;
    const { sectionType, itemType } = req.body;
    
    const caseData = await Case.findOne({
      _id: caseId,
      userId: req.user.id
    });
    
    if (!caseData) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    const sectionItems = caseData[sectionType];
    const itemIndex = sectionItems.findIndex(item => {
      if (itemType === 'file' && item.fileId) {
        return item.fileId.toString() === itemId;
      } else if (itemType === 'note' && item.noteId) {
        return item.noteId.toString() === itemId;
      }
      return false;
    });
    
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    sectionItems.splice(itemIndex, 1);
    await caseData.save();
    
    if (itemType === 'file') {
      const file = await File.findById(itemId);
      if (file) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        await File.findByIdAndDelete(itemId);
      }
    } else if (itemType === 'note') {
      await Note.findByIdAndDelete(itemId);
    }
    
    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get file content
app.get('/api/files/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const file = await File.findOne({
      _id: id,
      uploadedBy: req.user.id
    });
    
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }
    
    res.json({
      id: file._id,
      name: file.originalName,
      mimetype: file.mimetype,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      uploadedAt: file.uploadedAt,
      url: `/uploads/${path.relative('uploads', file.path)}`
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get note content
app.get('/api/notes/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const note = await Note.findOne({
      _id: id,
      createdBy: req.user.id
    });
    
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }
    
    res.json(note);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Status update route
app.patch('/api/cases/:id/status', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['pending', 'completed', 'hearing'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    const updatedCase = await Case.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { status, updatedAt: new Date() },
      { new: true }
    );
    
    if (!updatedCase) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json({
      message: 'Status updated successfully',
      data: updatedCase
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// =============== MORE ABOUT CARDS ROUTES ===============
// GET all more about cards
app.get('/api/more-about-cards', async (req, res) => {
  try {
    const cards = await MoreAboutCard.find({});
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET more about cards by category
app.get('/api/more-about-cards/category/:category', async (req, res) => {
  try {
    const category = req.params.category;
    const cards = await MoreAboutCard.find({ category });
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single more about card
app.get('/api/more-about-cards/:id', async (req, res) => {
  try {
    const card = await MoreAboutCard.findById(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create new more about card (FIXED)
app.post('/api/more-about-cards', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { category, date, title, description, isLocked } = req.body;

    let imagePath = '/uploads/default.jpg';
    if (req.file) {
      const correctSubfolder = 'more-about-cards';
      const correctDestDir = path.join(__dirname, 'uploads', correctSubfolder);
      const newPath = path.join(correctDestDir, req.file.filename);

      fs.mkdirSync(correctDestDir, { recursive: true });
      fs.renameSync(req.file.path, newPath);

      imagePath = `/uploads/${correctSubfolder}/${req.file.filename}`;
    }

    const newCard = new MoreAboutCard({
      category,
      image: imagePath,
      date,
      title,
      description,
      isLocked: isLocked === 'true' || isLocked === true
    });

    await newCard.save();
    res.status(201).json(newCard);
  } catch (error) {
    console.error('Error creating more about card:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// PUT update more about card (FIXED)
app.put('/api/more-about-cards/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { category, date, title, description, isLocked } = req.body;

    const updateData = {
      category,
      date,
      title,
      description,
      isLocked: isLocked === 'true' || isLocked === true
    };

    if (req.file) {
      const correctSubfolder = 'more-about-cards';
      const correctDestDir = path.join(__dirname, 'uploads', correctSubfolder);
      const newPath = path.join(correctDestDir, req.file.filename);

      fs.mkdirSync(correctDestDir, { recursive: true });
      fs.renameSync(req.file.path, newPath);

      updateData.image = `/uploads/${correctSubfolder}/${req.file.filename}`;
    }

    const card = await MoreAboutCard.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }

    res.json(card);
  } catch (error) {
    console.error('Error updating more about card:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// DELETE more about card
app.delete('/api/more-about-cards/:id', authMiddleware, async (req, res) => {
  try {
    const card = await MoreAboutCard.findByIdAndDelete(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    res.json({ message: 'Card deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// =============== LATEST UPDATES ROUTES ===============
// GET all latest updates
app.get('/api/latest-updates', async (req, res) => {
  try {
    const updates = await LatestUpdate.find({});
    res.json(updates);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single latest update
app.get('/api/latest-updates/:id', async (req, res) => {
  try {
    const update = await LatestUpdate.findById(req.params.id);
    if (!update) {
      return res.status(404).json({ error: 'Update not found' });
    }
    res.json(update);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create new latest update (FIXED)
app.post('/api/latest-updates', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { title, summary, details, date, type, gradient } = req.body;

    let imagePath = '/uploads/default.jpg';
    if (req.file) {
      const correctSubfolder = 'latest-updates';
      const correctDestDir = path.join(__dirname, 'uploads', correctSubfolder);
      const newPath = path.join(correctDestDir, req.file.filename);

      fs.mkdirSync(correctDestDir, { recursive: true });
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
      gradient: gradient || 'linear-gradient(135deg, #454444 0%, #c79f44 100%)'
    });

    await newUpdate.save();
    res.status(201).json(newUpdate);
  } catch (error) {
    console.error('Error creating latest update:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// PUT update latest update (FIXED)
app.put('/api/latest-updates/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { title, summary, details, date, type, gradient } = req.body;

    const updateData = {
      title,
      summary,
      details,
      date,
      type,
      gradient
    };

    if (req.file) {
      const correctSubfolder = 'latest-updates';
      const correctDestDir = path.join(__dirname, 'uploads', correctSubfolder);
      const newPath = path.join(correctDestDir, req.file.filename);

      fs.mkdirSync(correctDestDir, { recursive: true });
      fs.renameSync(req.file.path, newPath);

      updateData.image = `/uploads/${correctSubfolder}/${req.file.filename}`;
    }

    const update = await LatestUpdate.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!update) {
      return res.status(404).json({ error: 'Update not found' });
    }

    res.json(update);
  } catch (error) {
    console.error('Error updating latest update:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// DELETE latest update
app.delete('/api/latest-updates/:id', authMiddleware, async (req, res) => {
  try {
    const update = await LatestUpdate.findByIdAndDelete(req.params.id);
    if (!update) {
      return res.status(404).json({ error: 'Update not found' });
    }
    
    res.json({ message: 'Update deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// =============== ANNOUNCEMENTS ROUTES ===============
// GET all announcements
app.get('/api/announcements', async (req, res) => {
  try {
    const { category } = req.query;
    let filter = {};
    
    if (category && category !== 'ALL') {
      filter.category = category;
    }
    
    const announcements = await Announcement.find(filter);
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET single announcement
app.get('/api/announcements/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    res.json(announcement);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create new announcement (FIXED)
app.post('/api/announcements', authMiddleware, async (req, res) => {
  try {
    const { date, type, title, link, category, priority } = req.body;
    
    const newAnnouncement = new Announcement({
      date,
      type,
      title,
      link: link || '#',
      category,
      priority: priority || 'medium'
    });
    
    await newAnnouncement.save();
    res.status(201).json(newAnnouncement);
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// PUT update announcement (FIXED)
app.put('/api/announcements/:id', authMiddleware, async (req, res) => {
  try {
    const { date, type, title, link, category, priority } = req.body;
    
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      { 
        date, 
        type, 
        title, 
        link: link || '#', 
        category, 
        priority: priority || 'medium' 
      },
      { new: true }
    );
    
    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    
    res.json(announcement);
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// DELETE announcement
app.delete('/api/announcements/:id', authMiddleware, async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// =============== BOOK ROUTES ===============
// Get all books (with optional category filter)
app.get('/api/books', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = { isActive: true };

    if (category) {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } }
      ];
    }

    const books = await Book.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: books });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching books', error: error.message });
  }
});

// Get single book by ID
app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    res.json({ success: true, data: book });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching book', error: error.message });
  }
});

// Create new book
app.post('/api/books', authMiddleware, uploadBook.fields([
  { name: 'image', maxCount: 1 },
  { name: 'pdfFile', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.image || !req.files.pdfFile) {
      return res.status(400).json({ 
        success: false, 
        message: 'Both image and PDF file are required' 
      });
    }

    const imagePath = '/uploads/book-images/' + req.files.image[0].filename;
    const pdfPath = '/uploads/books/' + req.files.pdfFile[0].filename;
    const fileSize = getFileSize(req.files.pdfFile[0].path);

    const bookData = {
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      author: req.body.author || '',
      image: imagePath,
      pdfFile: pdfPath,
      fileSize: fileSize,
      publishedDate: req.body.publishedDate || Date.now()
    };

    const newBook = new Book(bookData);
    await newBook.save();

    res.status(201).json({ 
      success: true, 
      message: 'Book created successfully', 
      data: newBook 
    });
  } catch (error) {
    // Clean up uploaded files if there's an error
    if (req.files) {
      if (req.files.image) deleteFile(req.files.image[0].path);
      if (req.files.pdfFile) deleteFile(req.files.pdfFile[0].path);
    }
    res.status(500).json({ 
      success: false, 
      message: 'Error creating book', 
      error: error.message 
    });
  }
});

// Update book
app.put('/api/books/:id', authMiddleware, uploadBook.fields([
  { name: 'image', maxCount: 1 },
  { name: 'pdfFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    const updateData = {
      title: req.body.title || book.title,
      description: req.body.description || book.description,
      category: req.body.category || book.category,
      author: req.body.author || book.author,
      publishedDate: req.body.publishedDate || book.publishedDate
    };

    // Handle image update
    if (req.files && req.files.image) {
      deleteFile('.' + book.image);
      updateData.image = '/uploads/book-images/' + req.files.image[0].filename;
    }

    // Handle PDF update
    if (req.files && req.files.pdfFile) {
      deleteFile('.' + book.pdfFile);
      updateData.pdfFile = '/uploads/books/' + req.files.pdfFile[0].filename;
      updateData.fileSize = getFileSize(req.files.pdfFile[0].path);
    }

    const updatedBook = await Book.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json({ 
      success: true, 
      message: 'Book updated successfully', 
      data: updatedBook 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error updating book', 
      error: error.message 
    });
  }
});

// Delete book
app.delete('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    // Delete associated files
    deleteFile('.' + book.image);
    deleteFile('.' + book.pdfFile);

    await Book.findByIdAndDelete(req.params.id);

    res.json({ 
      success: true, 
      message: 'Book deleted successfully' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting book', 
      error: error.message 
    });
  }
});

// Download book (increment download count)
app.get('/api/books/:id/download', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    // Increment download count
    book.downloads += 1;
    await book.save();

    const filePath = path.join(__dirname, book.pdfFile);
    res.download(filePath, `${book.title}.pdf`);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error downloading book', 
      error: error.message 
    });
  }
});

// Get books by category (for stats)
app.get('/api/books/stats/by-category', async (req, res) => {
  try {
    const stats = await Book.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching stats', 
      error: error.message 
    });
  }
});

// =============== STANDALONE NOTES ROUTES (FROM SECOND FILE) ===============
// =============== UPDATED STANDALONE NOTES ROUTES (USER-SPECIFIC) ===============
// Replace the existing standalone notes routes in your index.js with these:

// UPDATED: Get all notes for logged-in user only
app.get('/api/standalone/notes', authMiddleware, async (req, res) => {
  try {
    // Only fetch notes created by the logged-in user
    const notes = await StandaloneNote.find({ createdBy: req.user.id })
      .sort({ createdAt: -1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notes', error: error.message });
  }
});

// UPDATED: Get single note by ID (only if user owns it)
app.get('/api/standalone/notes/:id', authMiddleware, async (req, res) => {
  try {
    const note = await StandaloneNote.findOne({
      _id: req.params.id,
      createdBy: req.user.id  // Ensure user owns the note
    });
    
    if (!note) {
      return res.status(404).json({ message: 'Note not found or access denied' });
    }
    res.json(note);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching note', error: error.message });
  }
});

// UPDATED: Create new note (linked to logged-in user)
app.post('/api/standalone/notes', authMiddleware, async (req, res) => {
  try {
    const { title, content, date } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    const newNote = new StandaloneNote({
      title,
      content,
      date: date || new Date().toLocaleString(),
      createdBy: req.user.id  // Link note to logged-in user
    });

    const savedNote = await newNote.save();
    res.status(201).json(savedNote);
  } catch (error) {
    res.status(500).json({ message: 'Error creating note', error: error.message });
  }
});

// UPDATED: Update note (only if user owns it)
app.put('/api/standalone/notes/:id', authMiddleware, async (req, res) => {
  try {
    const { title, content, date } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    const updatedNote = await StandaloneNote.findOneAndUpdate(
      { 
        _id: req.params.id,
        createdBy: req.user.id  // Ensure user owns the note
      },
      { title, content, date },
      { new: true, runValidators: true }
    );

    if (!updatedNote) {
      return res.status(404).json({ message: 'Note not found or access denied' });
    }

    res.json(updatedNote);
  } catch (error) {
    res.status(500).json({ message: 'Error updating note', error: error.message });
  }
});

// UPDATED: Delete note (only if user owns it)
app.delete('/api/standalone/notes/:id', authMiddleware, async (req, res) => {
  try {
    const deletedNote = await StandaloneNote.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user.id  // Ensure user owns the note
    });
    
    if (!deletedNote) {
      return res.status(404).json({ message: 'Note not found or access denied' });
    }

    res.json({ message: 'Note deleted successfully', note: deletedNote });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting note', error: error.message });
  }
});

// UPDATED: Search notes (only user's own notes)
app.get('/api/standalone/notes/search/:query', authMiddleware, async (req, res) => {
  try {
    const query = req.params.query;
    const notes = await StandaloneNote.find({
      createdBy: req.user.id,  // Only search in user's notes
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { content: { $regex: query, $options: 'i' } }
      ]
    }).sort({ createdAt: -1 });
    
    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Error searching notes', error: error.message });
  }
});
// =============== UTILITY ROUTES ===============
// GET dashboard stats
app.get('/api/dashboard-stats', async (req, res) => {
  try {
    const totalMoreAboutCards = await MoreAboutCard.countDocuments();
    const totalLatestUpdates = await LatestUpdate.countDocuments();
    const totalAnnouncements = await Announcement.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalBooks = await Book.countDocuments({ isActive: true });
    const totalStandaloneNotes = await StandaloneNote.countDocuments();
    
    const categoriesCount = {
      Law: await MoreAboutCard.countDocuments({ category: 'Law' }),
      Cases: await MoreAboutCard.countDocuments({ category: 'Cases' }),
      Books: await MoreAboutCard.countDocuments({ category: 'Books' }),
      ACTS: await MoreAboutCard.countDocuments({ category: 'ACTS' })
    };
    
    const announcementsByType = {
      TENDERS: await Announcement.countDocuments({ category: 'TENDERS' }),
      NOTIFICATIONS: await Announcement.countDocuments({ category: 'NOTIFICATIONS' }),
      PRESS_RELEASE: await Announcement.countDocuments({ category: 'PRESS_RELEASE' }),
      NEWS: await Announcement.countDocuments({ category: 'NEWS' }),
      EVENTS: await Announcement.countDocuments({ category: 'EVENTS' }),
      DOWNLOADS: await Announcement.countDocuments({ category: 'DOWNLOADS' })
    };

    const booksByCategory = await Book.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    
    const stats = {
      totalMoreAboutCards,
      totalLatestUpdates,
      totalAnnouncements,
      totalUsers,
      totalBooks,
      totalStandaloneNotes,
      categoriesCount,
      announcementsByType,
      booksByCategory
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// FIXED: General file upload endpoint for admin dashboard
app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = new File({
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user.id
    });

    await file.save();

    res.json({
      message: 'File uploaded successfully',
      fileId: file._id,
      url: `/uploads/${path.relative('uploads', req.file.path)}`,
      filename: req.file.filename,
      originalName: req.file.originalname
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    timestamp: new Date(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 50MB.' });
    }
  }
  
  res.status(500).json({ message: error.message || 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
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
        role: "admin",
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
          category: 'Law',
          image: '/uploads/default-1.jpg',
          date: 'April 09, 2025',
          title: 'Understanding Constitutional Law',
          description: 'A comprehensive guide to constitutional principles and their applications in modern legal practice.',
          isLocked: false
        },
        {
          category: 'Cases',
          image: '/uploads/default-2.jpg',
          date: 'April 10, 2025',
          title: 'Landmark Supreme Court Cases',
          description: 'Analysis of pivotal cases that shaped modern jurisprudence and legal precedents.',
          isLocked: true
        }
      ];
      
      await MoreAboutCard.insertMany(defaultCards);
      console.log('Default more about cards created');
    }
    
    // Check if we need to create default latest updates
    const updateCount = await LatestUpdate.countDocuments();
    if (updateCount === 0) {
      const defaultUpdates = [
        {
          title: 'New AI Legal Research Feature',
          summary: 'Enhanced case law research with AI-powered insights',
          details: 'Our new AI research tool can analyze thousands of cases in seconds, providing you with relevant precedents and legal arguments.',
          date: '2 days ago',
          type: 'Feature',
          image: '/uploads/default-3.jpg',
          gradient: 'linear-gradient(135deg, #454444 0%, #c79f44 100%)'
        },
        {
          title: 'Security Enhancement Update',
          summary: 'Advanced encryption for document protection',
          details: 'We have implemented military-grade encryption to ensure your sensitive legal documents are protected at all times.',
          date: '5 days ago',
          type: 'Security',
          image: '/uploads/default-4.jpg',
          gradient: 'linear-gradient(135deg, #3b3b3b 0%, #c79f44 100%)'
        }
      ];
      
      await LatestUpdate.insertMany(defaultUpdates);
      console.log('Default latest updates created');
    }
    
    // Check if we need to create default announcements
    const announcementCount = await Announcement.countDocuments();
    if (announcementCount === 0) {
      const defaultAnnouncements = [
        {
          date: '16-MAY-2025',
          type: 'Tender',
          title: 'Islamabad High Court Islamabad invites electronic bids through PPPRA EPPADS portal as per Rule-2004, Rule 3(a), (Single Stage on...',
          link: '#',
          category: 'TENDERS',
          priority: 'high'
        },
        {
          date: '24-FEB-2025',
          type: 'Notification',
          title: 'New court procedures for digital document submission now in effect',
          link: '#',
          category: 'NOTIFICATIONS',
          priority: 'medium'
        }
      ];
      
      await Announcement.insertMany(defaultAnnouncements);
      console.log('Default announcements created');
    }

    // Check if we need to create default books
    const bookCount = await Book.countDocuments();
    if (bookCount === 0) {
      const defaultBooks = [
        {
          title: 'Constitutional Law of Pakistan',
          description: 'Comprehensive guide to the constitutional framework of Pakistan',
          category: 'Books',
          image: '/uploads/default-book-1.jpg',
          pdfFile: '/uploads/default-pdf-1.pdf',
          author: 'Legal Experts',
          fileSize: '2.5 MB',
          downloads: 0
        },
        {
          title: 'Criminal Procedure Code',
          description: 'Detailed analysis of criminal procedures and court processes',
          category: 'Acts & Rules',
          image: '/uploads/default-book-2.jpg',
          pdfFile: '/uploads/default-pdf-2.pdf',
          author: 'Justice Department',
          fileSize: '3.1 MB',
          downloads: 0
        }
      ];
      
      await Book.insertMany(defaultBooks);
      console.log('Default books created');
    }

    // Check if we need to create default standalone notes
    const noteCount = await StandaloneNote.countDocuments();
    if (noteCount === 0) {
      const defaultNotes = [
        {
          title: 'Welcome to Voice of Law',
          content: 'This is your first note. You can create, edit, and delete notes here.',
          date: new Date().toLocaleString()
        }
      ];
      
      await StandaloneNote.insertMany(defaultNotes);
      console.log('Default standalone notes created');
    }
  } catch (error) {
    console.error('Error initializing default data:', error);
  }
}

createAdminUser();
initializeDefaultData();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Combined Server is running on http://localhost:${PORT}`);
  console.log(`📁 Upload directories created`);
  console.log(`📚 Book management system integrated`);
  console.log(`📝 Standalone notes system integrated`);
  console.log(`👤 Admin Login: admin@example.com / password123`);
});