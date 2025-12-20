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
  .catch((err) => console.error(err));

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["employee", "hr"] },
  companyName: String, // HR এর জন্য
  companyLogo: String, // HR এর জন্য
  packageLimit: { type: Number, default: 5 },
  currentEmployees: { type: Number, default: 0 },
  subscription: { type: String, default: "basic" },
  dateOfBirth: Date,
  profileImage: String,
  // এমপ্লয়ি কোন কোন কোম্পানিতে আছে তার লিস্ট
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

    const result = await newUser.save(); // insertOne এর বদলে save()
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});
// --- HR: ASSET MANAGEMENT ---
app.post("/api/assets", async (req, res) => {
  const asset = new Asset({ ...req.body, availableQuantity: req.body.productQuantity });
  await asset.save();
  res.json(asset);
});

app.get("/api/assets/hr/:email", async (req, res) => {
  try {
    const { search, type } = req.query;
    const email = req.params.email;

    let query = {
      hrEmail: { $regex: new RegExp(`^${email}$`, "i") }
    };

    if (search) {
      query.productName = { $regex: search, $options: "i" };
    }

    if (type && type !== "All") {
      query.productType = type;
    }

    const assets = await Asset.find(query);
    res.json(assets);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch assets", error: err.message });
  }
});

app.post("/api/requests", async (req, res) => {
  try {
    const requestData = req.body;

    const newRequest = new Request({
      ...requestData,
      requestStatus: "pending",
      requestDate: new Date()
    });

    const result = await newRequest.save();
    res.status(201).json(result);
  } catch (err) {
    console.error("Request Error:", err);
    res.status(400).json({ message: "Failed to submit request", error: err.message });
  }
});

app.post("/api/requests/:id/approve", async (req, res) => {
  try {
    const requestId = req.params.id;
    const request = await Request.findById(requestId);

    if (!request) return res.status(404).json({ message: "Request not found" });

    const hr = await User.findOne({
      email: { $regex: new RegExp(`^${request.hrEmail}$`, "i") }
    });
    const employee = await User.findOne({
      email: { $regex: new RegExp(`^${request.requesterEmail}$`, "i") }
    });

    if (!hr || !employee) {
      return res.status(404).json({ message: "HR or Employee profile not found." });
    }

    if (hr.currentEmployees >= hr.packageLimit) {
      return res.status(400).json({ message: "Package limit reached!" });
    }

    const alreadyAffiliated = employee.affiliations?.some(
      (aff) => aff.hrEmail.toLowerCase() === hr.email.toLowerCase()
    );

    if (!alreadyAffiliated) {
      await Asset.findByIdAndUpdate(request.assetId, { $inc: { availableQuantity: -1 } });

      await User.findOneAndUpdate(
        { email: employee.email },
        { 
          $push: { 
            affiliations: { 
              companyName: hr.companyName, 
              hrEmail: hr.email.toLowerCase()
            } 
          } 
        }
      );

      await User.findOneAndUpdate(
        { email: hr.email }, 
        { $inc: { currentEmployees: 1 } }
      );
    }

    request.requestStatus = "approved";
    request.approvalDate = new Date();
    await request.save();

    res.json({ message: "Approved successfully", status: "approved" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/api/requests/:id/reject", async (req, res) => {
  try {
    const requestId = req.params.id;

    const updatedRequest = await Request.findByIdAndUpdate(
      requestId,
      {
        $set: {
          requestStatus: "rejected",
          rejectionDate: new Date()
        }
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ message: "Request rejected successfully", data: updatedRequest });
  } catch (err) {
    console.error("Reject Error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// --- EMPLOYEE DASHBOARD ---

app.get("/api/my-assets", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const requests = await Request.find({
      requesterEmail: { $regex: new RegExp(`^${email}$`, "i") }
    }).sort({ requestDate: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/api/requests/:id", async (req, res) => {
  try {
    const result = await Request.findByIdAndDelete(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to delete request" });
  }
});

// Return Asset
app.post("/api/return/:id", async (req, res) => {
  const request = await Request.findById(req.params.id);
  if (request.assetType !== "Returnable") return res.status(400).json({ message: "Non-returnable item" });

  request.requestStatus = "returned";
  await request.save();
  await Asset.findByIdAndUpdate(request.assetId, { $inc: { availableQuantity: 1 } });
  res.json({ message: "Returned" });
});

// My Team List
app.get("/api/my-team", async (req, res) => {
  try {
    const { email } = req.query;
    const currentUser = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, "i") } });

    if (!currentUser) return res.status(404).send({ message: "User not found" });

    let hrEmail = "";
    if (currentUser.role === "hr") {
      hrEmail = currentUser.email;
    } else {
      hrEmail = currentUser.affiliations?.[0]?.hrEmail;
    }

    if (!hrEmail) return res.json([]);

    const teamMembers = await User.find({
      $or: [
        { email: { $regex: new RegExp(`^${hrEmail}$`, "i") } },
        { "affiliations.hrEmail": { $regex: new RegExp(`^${hrEmail}$`, "i") } }
      ]
    }).select("-password");

    res.json(teamMembers);
  } catch (err) {
    res.status(500).send({ message: "Server error" });
  }
});
app.get('/packages', async (req, res) => {
  try {
    const result = await Package.find();
    res.json(result);
  } catch (err) {
    console.error("❌ Failed to fetch packages:", err);
    res.status(500).json({ message: "Failed to fetch packages" });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({
      email: { $regex: new RegExp(`^${email}$`, "i") }
    });

    // const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user data", error: err.message });
  }
});

app.get("/api/assets", async (req, res) => {
  try {
    const assets = await Asset.find({ availableQuantity: { $gt: 0 } });
    res.json(assets);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch assets", error: err.message });
  }
});

app.get("/api/requests", async (req, res) => {
  try {
    const { email } = req.query;
    const query = email ? { hrEmail: email } : {};
    const requests = await Request.find(query).sort({ requestDate: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch requests" });
  }
});

app.get("/api/employees", async (req, res) => {
  try {
    const { hrEmail } = req.query;
    const employees = await User.find({ "affiliations.hrEmail": hrEmail, role: "employee" });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch employees" });
  }
});


app.put("/api/profile", async (req, res) => {
  try {
    const { email } = req.query;  
    const { name, profileImage } = req.body; 

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const result = await User.findOneAndUpdate(
      { email: { $regex: new RegExp(`^${email}$`, "i") } },
      { $set: { name, profileImage } },
      { new: true } 
    );

    if (!result) {
      return res.status(404).json({ message: "User not found in database" });
    }

    res.json({ success: true, message: "Profile updated in DB", data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.listen(5000, () => console.log("Server running on port 5000"));