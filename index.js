require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: mongoose } = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(cors());

// --- Connect to MongoDB ---
const uri = process.env.MONGO_URI;  // Ensure this env var is defined properly
if (!uri) {
  console.error("❌ MONGO_URI not set in environment");
  process.exit(1);
}

mongoose.connect(uri)
  .then(() => console.log("MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });



// --- Mongoose models ---

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ['employee', 'hr'], default: 'employee' },
  companyName: String,
  companyLogo: String,
  packageLimit: Number,
  currentEmployees: Number,
  subscription: String,
  dateOfBirth: Date,
  profileImage: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});



const assetSchema = new mongoose.Schema({
  productName: String,
  productImage: String,
  productType: { type: String, enum: ['Returnable', 'Non-returnable'] },
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
  requestStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'returned'], default: 'pending' },
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
  status: { type: String, enum: ['assigned', 'returned'], default: 'assigned' },
});

const User = mongoose.model('User', userSchema);
const Asset = mongoose.model('Asset', assetSchema);
const Request = mongoose.model('Request', requestSchema);
const AssignedAsset = mongoose.model('AssignedAsset', assignedAssetSchema);




// / --- Middleware for auth & role ---

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  jwt.verify(token, process.env.JWT_SECRET || '', (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

const verifyHR = (req, res, next) => {
  if (req.user.role !== 'hr') return res.status(403).json({ message: 'Require HR role' });
  next();
};


// --- Routes ---
app.get('/', (req, res) => {
  res.send('API is running');
});


// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, dateOfBirth, role, companyName, companyLogo } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashed,
      role: role === 'hr' ? 'hr' : 'employee',
      dateOfBirth,
      ...(role === 'hr' ? { companyName, companyLogo, packageLimit: 5, currentEmployees: 0, subscription: 'basic' } : {}),
    });
    await user.save();
    res.json({ message: 'User registered' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: 'Invalid password' });
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, companyName: user.companyName },
      process.env.JWT_SECRET || '',
      { expiresIn: '1d' }
    );
    res.json({ token, user: { name: user.name, email: user.email, role: user.role, companyName: user.companyName } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Login failed', error: err.message });
  }
});


// Add Asset (only HR)
app.post('/api/assets', verifyToken, verifyHR, async (req, res) => {
  try {
    const { productName, productImage, productType, productQuantity } = req.body;
    const asset = new Asset({
      productName,
      productImage,
      productType,
      productQuantity,
      availableQuantity: productQuantity,
      hrEmail: req.user.email,
      companyName: req.user.companyName,
    });
    await asset.save();
    res.json({ message: 'Asset added', asset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Add asset failed', error: err.message });
  }
});

// List assets (for HR)
app.get('/api/assets', verifyToken, verifyHR, async (req, res) => {
  try {
    const assets = await Asset.find({ hrEmail: req.user.email });
    res.json(assets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Fetch assets failed', error: err.message });
  }
});











// Employee requests asset
app.post('/api/requests', verifyToken, async (req, res) => {
  try {
    const { assetId, note } = req.body;
    const asset = await Asset.findById(assetId);
    if (!asset || asset.availableQuantity <= 0) return res.status(400).json({ message: 'Asset not available' });
    const reqDoc = new Request({
      assetId,
      assetName: asset.productName,
      assetType: asset.productType,
      requesterName: req.user.name,
      requesterEmail: req.user.email,
      hrEmail: asset.hrEmail,
      companyName: asset.companyName,
      note,
    });
    await reqDoc.save();
    res.json({ message: 'Request submitted', request: reqDoc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Request failed', error: err.message });
  }
});

// HR: view all requests
app.get('/api/requests', verifyToken, verifyHR, async (req, res) => {
  try {
    const requests = await Request.find({ hrEmail: req.user.email, companyName: req.user.companyName });
    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Fetch requests failed', error: err.message });
  }
});

// HR: approve request
app.post('/api/requests/:id/approve', verifyToken, verifyHR, async (req, res) => {
  try {
    const reqId = req.params.id;
    const reqDoc = await Request.findById(reqId);
    if (!reqDoc) return res.status(404).json({ message: 'Request not found' });
    if (reqDoc.requestStatus !== 'pending') return res.status(400).json({ message: 'Already processed' });

    const asset = await Asset.findById(reqDoc.assetId);
    if (!asset || asset.availableQuantity <= 0) return res.status(400).json({ message: 'Asset not available' });

    asset.availableQuantity -= 1;
    await asset.save();

    reqDoc.requestStatus = 'approved';
    reqDoc.approvalDate = new Date();
    reqDoc.processedBy = req.user.email;
    await reqDoc.save();

    const assigned = new AssignedAsset({
      assetId: asset._id,
      assetName: asset.productName,
      assetImage: asset.productImage,
      assetType: asset.productType,
      employeeEmail: reqDoc.requesterEmail,
      employeeName: reqDoc.requesterName,
      hrEmail: req.user.email,
      companyName: asset.companyName,
    });
    await assigned.save();

    res.json({ message: 'Request approved and asset assigned', assigned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Approve failed', error: err.message });
  }
});

// Get employee’s assigned assets
app.get('/api/my-assets', verifyToken, async (req, res) => {
  try {
    const assigned = await AssignedAsset.find({ employeeEmail: req.user.email });
    res.json(assigned);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Fetch assigned assets failed', error: err.message });
  }
});





const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
