require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: mongoose } = require('mongoose');
const jwt = require('jsonwebtoken');

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



app.get('/', (req, res) => res.send('API is running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
