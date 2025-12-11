require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: mongoose } = require('mongoose');

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

const Asset = mongoose.model('Asset', assetSchema);



app.get('/', (req, res) => res.send('API is running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
