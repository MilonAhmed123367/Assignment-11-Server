const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');


const port = process.env.PORT || 3000


// middleware

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@milon.ycr1g5h.mongodb.net/?appName=Milon`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

