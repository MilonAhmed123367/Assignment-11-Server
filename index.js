require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();

// ১. CORS কনফিগারেশন - ভেরসেল এবং লোকাল হোস্টের জন্য
app.use(cors({
  origin: ["http://localhost:5173", "https://assignment-11-server-git-main-milon-ahmeds-projects.vercel.app"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
}));

app.use(express.json());

// প্রি-ফ্লাইট রিকোয়েস্ট হ্যান্ডলিং
app.options("*", cors());

/* ================= DB CONNECT ================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

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

/* ================= ROUTES ================= */

// --- AUTH ---
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
    const user = req.body;
    const query = { email: user.email.toLowerCase() };
    const existingUser = await User.findOne(query);

    if (existingUser) {
      return res.send({ message: "User logged in" });
    }

    const newUser = new User({
      name: user.name,
      email: user.email.toLowerCase(),
      profileImage: user.photoURL,
      role: "employee",
      subscription: "basic",
      affiliations: []
    });

    const result = await newUser.save();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// --- ASSET MANAGEMENT ---
app.post("/api/assets", async (req, res) => {
  const asset = new Asset({ ...req.body, availableQuantity: req.body.productQuantity });
  await asset.save();
  res.json(asset);
});

app.get("/api/assets/hr/:email", async (req, res) => {
  try {
    const { search, type } = req.query;
    const email = req.params.email;
    let query = { hrEmail: { $regex: new RegExp(`^${email}$`, "i") } };

    if (search) query.productName = { $regex: search, $options: "i" };
    if (type && type !== "All") query.productType = type;

    const assets = await Asset.find(query);
    res.json(assets);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch assets" });
  }
});

// --- REQUESTS ---
app.post("/api/requests", async (req, res) => {
  try {
    const newRequest = new Request({ ...req.body, requestStatus: "pending", requestDate: new Date() });
    const result = await newRequest.save();
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ message: "Failed to submit request" });
  }
});

app.post("/api/requests/:id/approve", async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    const hr = await User.findOne({ email: { $regex: new RegExp(`^${request.hrEmail}$`, "i") } });
    const employee = await User.findOne({ email: { $regex: new RegExp(`^${request.requesterEmail}$`, "i") } });

    if (hr.currentEmployees >= hr.packageLimit) return res.status(400).json({ message: "Package limit reached!" });

    const alreadyAffiliated = employee.affiliations?.some(aff => aff.hrEmail.toLowerCase() === hr.email.toLowerCase());

    if (!alreadyAffiliated) {
      await Asset.findByIdAndUpdate(request.assetId, { $inc: { availableQuantity: -1 } });
      await User.findOneAndUpdate({ email: employee.email }, {
        $push: { affiliations: { companyName: hr.companyName, hrEmail: hr.email.toLowerCase() } }
      });
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
    await Request.findByIdAndUpdate(req.params.id, { $set: { requestStatus: "rejected" } });
    res.json({ message: "Rejected" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

// --- DASHBOARD & TEAM ---
app.get("/api/my-assets", async (req, res) => {
  try {
    const { email } = req.query;
    const requests = await Request.find({ requesterEmail: { $regex: new RegExp(`^${email}$`, "i") } }).sort({ requestDate: -1 });
    res.json(requests || []);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/my-team", async (req, res) => {
  try {
    const { email } = req.query;
    const currentUser = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, "i") } });
    if (!currentUser) return res.status(404).send({ message: "User not found" });

    let hrEmail = currentUser.role === "hr" ? currentUser.email : currentUser.affiliations?.[0]?.hrEmail;
    if (!hrEmail) return res.json([]);

    const teamMembers = await User.find({
      $or: [{ email: { $regex: new RegExp(`^${hrEmail}$`, "i") } }, { "affiliations.hrEmail": { $regex: new RegExp(`^${hrEmail}$`, "i") } }]
    }).select("-password");
    res.json(teamMembers);
  } catch (err) { res.status(500).send({ message: "Server error" }); }
});

// --- PACKAGES (FIXED) ---
app.get('/api/packages', async (req, res) => {
  try {
    const result = await Package.find();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const user = await User.findOne({ email: { $regex: new RegExp(`^${req.query.email}$`, "i") } });
    user ? res.json(user) : res.status(404).json({ message: "Not found" });
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

// Other basic routes
app.get("/api/assets", async (req, res) => {
  const assets = await Asset.find({ availableQuantity: { $gt: 0 } });
  res.json(assets);
});

app.put("/api/profile", async (req, res) => {
  try {
    const result = await User.findOneAndUpdate(
      { email: { $regex: new RegExp(`^${req.query.email}$`, "i") } },
      { $set: req.body }, { new: true }
    );
    res.json(result);
  } catch (err) { res.status(500).json({ message: "Error" }); }
});

const port = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = app;