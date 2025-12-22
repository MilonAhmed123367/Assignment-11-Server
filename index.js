require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();

// ======= CORS CONFIGURATION =======
app.use(cors({
  origin: ["https://assignment-11-milon-ahmed.netlify.app", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

// ======= HANDLE PRE-FLIGHT =======
app.options('*', (req, res) => {
  res.sendStatus(200);
});

app.use(express.json());

// ======= DB CONNECT =======
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ DB Error:", err));

// ======= SCHEMAS =======
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["employee", "hr"] },
  companyName: String,
  companyLogo: String,
  packageLimit: { type: Number, default: 5 },
  currentEmployees: { type: Number, default: 0 },
  subscription: { type: String, default: "basic" },
  dateOfBirth: Date,
  profileImage: String,
  affiliations: [{
    companyName: String,
    hrEmail: String,
    joinedAt: { type: Date, default: Date.now }
  }]
});

const assetSchema = new mongoose.Schema({
  productName: String,
  productImage: String,
  productType: { type: String, enum: ["Returnable", "Non-returnable"] },
  productQuantity: Number,
  availableQuantity: Number,
  hrEmail: String,
  companyName: String,
  dateAdded: { type: Date, default: Date.now },
});

const requestSchema = new mongoose.Schema({
  assetId: mongoose.Schema.Types.ObjectId,
  assetName: String,
  assetType: String,
  requesterName: String,
  requesterEmail: String,
  hrEmail: String,
  companyName: String,
  requestDate: { type: Date, default: Date.now },
  approvalDate: Date,
  requestStatus: { type: String, enum: ["pending", "approved", "rejected", "returned"], default: "pending" },
  note: String,
});

const Package = mongoose.model("Package", new mongoose.Schema({
  name: String,
  employeeLimit: Number,
  price: Number,
  features: [String]
}));

const User = mongoose.model("User", userSchema);
const Asset = mongoose.model("Asset", assetSchema);
const Request = mongoose.model("Request", requestSchema);

// ======= ROUTES =======

app.get("/", (req, res) => res.send("Server running perfectly..."));

// --- AUTH ROUTES ---
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, role, companyName, companyLogo, dateOfBirth } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const userData = { name, email, password: hashed, role, dateOfBirth };
    if (role === "hr") {
      userData.companyName = companyName;
      userData.companyLogo = companyLogo;
    }
    const user = new User(userData);
    await user.save();
    res.json({ message: "Success", user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (user && await bcrypt.compare(password, user.password)) {
    res.json(user);
  } else {
    res.status(400).json({ message: "Invalid credentials" });
  }
});

app.post("/api/google-register", async (req, res) => {
  try {
    const newUser = new User({
      name: req.body.name,
      email: req.body.email.toLowerCase(),
      profileImage: req.body.photoURL,
      role: "employee",
      subscription: "basic",
      affiliations: []
    });
    const result = await newUser.save();
    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: "Server Error" });
  }
});

// --- ASSET ROUTES ---
app.post("/api/assets", async (req, res) => {
  try {
    const asset = new Asset({ ...req.body, availableQuantity: req.body.productQuantity });
    await asset.save();
    res.json(asset);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get("/api/assets/hr/:email", async (req, res) => {
  try {
    const query = { hrEmail: { $regex: new RegExp(`^${req.params.email}$`, "i") } };
    if (req.query.search) query.productName = { $regex: req.query.search, $options: "i" };
    if (req.query.type && req.query.type !== "All") query.productType = req.query.type;
    const assets = await Asset.find(query);
    res.json(assets);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

// --- MORE ROUTES OMITTED FOR BREVITY (same as your code) ---

// === PACKAGES & UTIL ROUTES ===
app.get('/api/packages', async (req, res) => {
  try {
    const result = await Package.find();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const user = await User.findOne({ email: { $regex: new RegExp(`^${req.query.email}$`, "i") } });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

app.get("/api/assets", async (req, res) => {
  try {
    const assets = await Asset.find({ availableQuantity: { $gt: 0 } });
    res.json(assets);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

// ======= SERVER =======
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));

module.exports = app;
