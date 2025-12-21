require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();

// ১. সঠিক CORS কনফিগারেশন (যা ভেরসেলে কাজ করবে)
app.use(cors({
  origin: true, // এটি আপনার লোকালহোস্ট এবং ভেরসেল দুইটাই অটোমেটিক হ্যান্ডেল করবে
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

app.use(express.json());

/* ================= DB CONNECT ================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ DB Error:", err));

/* ================= SCHEMAS ================= */
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

/* ================= ALL ROUTES (আপনার ৪৫৮ লাইনের লজিক) ================= */

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
  } catch (err) { res.status(400).json({ message: err.message }); }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (user && await bcrypt.compare(password, user.password)) {
    res.json(user);
  } else { res.status(400).json({ message: "Invalid credentials" }); }
});

app.post("/api/google-register", async (req, res) => {
  try {
    const user = req.body;
    const existingUser = await User.findOne({ email: user.email.toLowerCase() });
    if (existingUser) return res.send(existingUser);

    const newUser = new User({
      name: user.name,
      email: user.email.toLowerCase(),
      profileImage: user.photoURL,
      role: "employee",
      subscription: "basic",
      affiliations: []
    });
    const result = await newUser.save();
    res.status(201).send(result);
  } catch (error) { res.status(500).send({ message: "Server Error" }); }
});

// --- ASSET ROUTES ---
app.post("/api/assets", async (req, res) => {
  try {
    const asset = new Asset({ ...req.body, availableQuantity: req.body.productQuantity });
    await asset.save();
    res.json(asset);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

app.get("/api/assets/hr/:email", async (req, res) => {
  try {
    const query = { hrEmail: { $regex: new RegExp(`^${req.params.email}$`, "i") } };
    if (req.query.search) query.productName = { $regex: req.query.search, $options: "i" };
    if (req.query.type && req.query.type !== "All") query.productType = req.query.type;
    const assets = await Asset.find(query);
    res.json(assets);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

// --- REQUEST ROUTES ---
app.post("/api/requests", async (req, res) => {
  try {
    const newRequest = new Request({ ...req.body, requestStatus: "pending", requestDate: new Date() });
    const result = await newRequest.save();
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

app.post("/api/requests/:id/approve", async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Not found" });
    const hr = await User.findOne({ email: { $regex: new RegExp(`^${request.hrEmail}$`, "i") } });
    const employee = await User.findOne({ email: { $regex: new RegExp(`^${request.requesterEmail}$`, "i") } });

    if (!hr || !employee) return res.status(404).json({ message: "HR/Employee not found." });
    if (hr.currentEmployees >= hr.packageLimit) return res.status(400).json({ message: "Limit reached!" });

    const alreadyAffiliated = employee.affiliations?.some(aff => aff.hrEmail.toLowerCase() === hr.email.toLowerCase());
    if (!alreadyAffiliated) {
      await Asset.findByIdAndUpdate(request.assetId, { $inc: { availableQuantity: -1 } });
      await User.findOneAndUpdate({ email: employee.email }, { $push: { affiliations: { companyName: hr.companyName, hrEmail: hr.email.toLowerCase() } } });
      await User.findOneAndUpdate({ email: hr.email }, { $inc: { currentEmployees: 1 } });
    }
    request.requestStatus = "approved";
    request.approvalDate = new Date();
    await request.save();
    res.json({ message: "Approved successfully" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/requests/:id/reject", async (req, res) => {
  try {
    const updated = await Request.findByIdAndUpdate(req.params.id, { $set: { requestStatus: "rejected" } }, { new: true });
    res.json({ message: "Rejected", data: updated });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

// --- MY ASSETS & TEAM ---
app.get("/api/my-assets", async (req, res) => {
  try {
    const requests = await Request.find({ requesterEmail: { $regex: new RegExp(`^${req.query.email}$`, "i") } }).sort({ requestDate: -1 });
    res.json(requests || []);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.delete("/api/requests/:id", async (req, res) => {
  try {
    await Request.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.post("/api/return/:id", async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (request.assetType !== "Returnable") return res.status(400).json({ message: "Non-returnable" });
    request.requestStatus = "returned";
    await request.save();
    await Asset.findByIdAndUpdate(request.assetId, { $inc: { availableQuantity: 1 } });
    res.json({ message: "Returned" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/my-team", async (req, res) => {
  try {
    const currentUser = await User.findOne({ email: { $regex: new RegExp(`^${req.query.email}$`, "i") } });
    if (!currentUser) return res.status(404).send({ message: "User not found" });
    const hrEmail = currentUser.role === "hr" ? currentUser.email : currentUser.affiliations?.[0]?.hrEmail;
    if (!hrEmail) return res.json([]);
    const team = await User.find({ $or: [{ email: { $regex: new RegExp(`^${hrEmail}$`, "i") } }, { "affiliations.hrEmail": { $regex: new RegExp(`^${hrEmail}$`, "i") } }] }).select("-password");
    res.json(team);
  } catch (err) { res.status(500).send({ message: "Server error" }); }
});

// --- OTHER UTILS ---
app.get('/api/packages', async (req, res) => {
  try {
    const result = await Package.find();
    res.json(result);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/me", async (req, res) => {
  try {
    const user = await User.findOne({ email: { $regex: new RegExp(`^${req.query.email}$`, "i") } });
    res.json(user);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/assets", async (req, res) => {
  try {
    const assets = await Asset.find({ availableQuantity: { $gt: 0 } });
    res.json(assets);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/requests", async (req, res) => {
  try {
    const query = req.query.email ? { hrEmail: req.query.email } : {};
    const requests = await Request.find(query).sort({ requestDate: -1 });
    res.json(requests);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/employees", async (req, res) => {
  try {
    const employees = await User.find({ "affiliations.hrEmail": req.query.hrEmail, role: "employee" });
    res.json(employees);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.put("/api/profile", async (req, res) => {
  try {
    const result = await User.findOneAndUpdate(
      { email: { $regex: new RegExp(`^${req.query.email}$`, "i") } },
      { $set: { name: req.body.name, profileImage: req.body.profileImage } },
      { new: true }
    );
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

/* ================= SERVER START ================= */
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));

module.exports = app;