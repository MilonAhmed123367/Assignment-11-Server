require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

/* ================= DB CONNECT ================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["employee", "hr"], default: "employee" },

  companyName: String,
  companyLogo: String,

  packageLimit: Number,
  currentEmployees: Number,
  subscription: String,

  companies: [
    {
      companyName: String,
      hrEmail: String,
      joinedAt: Date,
    },
  ],

  dateOfBirth: Date,
  profileImage: String,
  createdAt: { type: Date, default: Date.now },
});

const assetSchema = new mongoose.Schema({
  productName: String,
  productImage: String,
  productType: { type: String, enum: ["Returnable", "Non-returnable"] },
  productQuantity: Number,
  availableQuantity: Number,
  dateAdded: { type: Date, default: Date.now },
  hrEmail: String,
  companyName: String,
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

  requestStatus: {
    type: String,
    enum: ["pending", "approved", "rejected", "returned"],
    default: "pending",
  },

  note: String,
  processedBy: String,
});

const assignedAssetSchema = new mongoose.Schema({
  assetId: mongoose.Schema.Types.ObjectId,
  assetName: String,
  assetImage: String,
  assetType: String,

  employeeEmail: String,
  employeeName: String,

  hrEmail: String,
  companyName: String,

  assignmentDate: { type: Date, default: Date.now },
  returnDate: Date,

  status: { type: String, enum: ["assigned", "returned"], default: "assigned" },
});

const packageSchema = new mongoose.Schema({
  name: String,
  employeeLimit: Number,
  price: Number,
  features: [String],
});

/* ================= MODELS ================= */
const User = mongoose.model("User", userSchema);
const Asset = mongoose.model("Asset", assetSchema);
const Request = mongoose.model("Request", requestSchema);
const AssignedAsset = mongoose.model("AssignedAsset", assignedAssetSchema);
const Package = mongoose.model("Package", packageSchema);

/* ================= ROUTES ================= */

/* ===== AUTH ===== */

// Register
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, role, companyName, companyLogo, dateOfBirth } =
      req.body;
    const hashed = await bcrypt.hash(password, 10);

    const userData = {
      name,
      email,
      password: hashed,
      role,
      dateOfBirth,
    };

    if (role === "hr") {
      userData.companyName = companyName;
      userData.companyLogo = companyLogo;
      userData.packageLimit = 5;
      userData.currentEmployees = 0;
      userData.subscription = "basic";
    }

    const user = new User(userData);
    await user.save();

    res.json({ message: "Registered Successfully", user });
  } catch (err) {
    res.status(400).json({ message: "Registration Failed", error: err.message });
  }
});

// Login (no token)
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Wrong password" });

    res.json({ message: "Login success", user });
  } catch (err) {
    res.status(500).json({ message: "Login failed" });
  }
});

/* ===== PROFILE ===== */
app.put("/api/profile/:id", async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Profile update failed" });
  }
});

/* ===== ASSETS ===== */
app.post("/api/assets", async (req, res) => {
  try {
    const asset = new Asset({
      ...req.body,
      availableQuantity: req.body.productQuantity,
    });
    await asset.save();
    res.json(asset);
  } catch {
    res.status(500).json({ message: "Add asset failed" });
  }
});

app.get("/api/assets", async (req, res) => {
  const assets = await Asset.find();
  res.json(assets);
});

app.put("/api/assets/:id", async (req, res) => {
  const updated = await Asset.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  res.json(updated);
});

app.delete("/api/assets/:id", async (req, res) => {
  await Asset.findByIdAndDelete(req.params.id);
  res.json({ message: "Asset deleted" });
});

/* ===== REQUESTS ===== */
app.post("/api/requests", async (req, res) => {
  try {
    const asset = await Asset.findById(req.body.assetId);
    if (!asset || asset.availableQuantity <= 0)
      return res.status(400).json({ message: "Asset unavailable" });

    const request = new Request({
      assetId: asset._id,
      assetName: asset.productName,
      assetType: asset.productType,
      requesterName: req.body.requesterName,
      requesterEmail: req.body.requesterEmail,
      hrEmail: asset.hrEmail,
      companyName: asset.companyName,
      note: req.body.note,
    });

    await request.save();
    res.json(request);
  } catch {
    res.status(500).json({ message: "Request failed" });
  }
});

app.get("/api/requests", async (req, res) => {
  const requests = await Request.find();
  res.json(requests);
});

app.post("/api/requests/:id/approve", async (req, res) => {
  try {
    const reqItem = await Request.findById(req.params.id);
    if (!reqItem || reqItem.requestStatus !== "pending")
      return res.status(400).json({ message: "Invalid request" });

    const asset = await Asset.findById(reqItem.assetId);
    if (!asset || asset.availableQuantity <= 0)
      return res.status(400).json({ message: "Asset unavailable" });

    asset.availableQuantity -= 1;
    await asset.save();

    reqItem.requestStatus = "approved";
    reqItem.approvalDate = new Date();
    await reqItem.save();

    await AssignedAsset.create({
      assetId: asset._id,
      assetName: asset.productName,
      assetImage: asset.productImage,
      assetType: asset.productType,
      employeeEmail: reqItem.requesterEmail,
      employeeName: reqItem.requesterName,
      hrEmail: reqItem.hrEmail,
      companyName: asset.companyName,
    });

    res.json({ message: "Request approved" });
  } catch {
    res.status(500).json({ message: "Approve failed" });
  }
});

app.post("/api/requests/:id/reject", async (req, res) => {
  await Request.findByIdAndUpdate(req.params.id, { requestStatus: "rejected" });
  res.json({ message: "Request rejected" });
});




app.get("/api/me", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

/* ===== RETURN ===== */
app.post("/api/return/:id", async (req, res) => {
  try {
    const assigned = await AssignedAsset.findById(req.params.id);
    if (!assigned || assigned.status === "returned")
      return res.status(400).json({ message: "Invalid return" });

    assigned.status = "returned";
    assigned.returnDate = new Date();
    await assigned.save();

    await Asset.findByIdAndUpdate(assigned.assetId, {
      $inc: { availableQuantity: 1 },
    });

    await Request.findOneAndUpdate(
      { assetId: assigned.assetId, requesterEmail: assigned.employeeEmail },
      { requestStatus: "returned" }
    );

    res.json({ message: "Asset returned" });
  } catch {
    res.status(500).json({ message: "Return failed" });
  }
});

/* ===== EMPLOYEE ===== */
app.get("/api/my-assets/:email", async (req, res) => {
  const assets = await AssignedAsset.find({ employeeEmail: req.params.email });
  res.json(assets);
});

app.get("/api/my-team/:companyName/:email", async (req, res) => {
  const team = await User.find({
    "companies.companyName": req.params.companyName,
    email: { $ne: req.params.email },
  });
  res.json(team);
});

/* ===== HR EMPLOYEES ===== */
app.get("/api/employees/:companyName", async (req, res) => {
  const employees = await User.find({
    role: "employee",
    "companies.companyName": req.params.companyName,
  });
  res.json(employees);
});

/* ===== DASHBOARD ===== */
app.get("/api/dashboard-summary/:hrEmail", async (req, res) => {
  const totalAssets = await Asset.countDocuments({ hrEmail: req.params.hrEmail });
  const pending = await Request.countDocuments({ hrEmail: req.params.hrEmail, requestStatus: "pending" });
  const assigned = await AssignedAsset.countDocuments({ hrEmail: req.params.hrEmail });
  res.json({ totalAssets, pending, assigned });
});

/* ===== PUBLIC ===== */
app.get("/packages", async (req, res) => {
  const packs = await Package.find();
  res.json(packs);
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
