const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
  })
});

const db = admin.firestore();
const app = express();

app.use(cors());

// PLAN LIMITS & FEATURE QUOTAS
const PLAN_LIMITS = {
  free: 2500,
  starter: 50000,
  pro: 500000,
  business: 3000000,
  enterprise: Infinity
};

// Middleware: Validate API Key + Enforce Plan Quotas
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  // 1. Fetch API Key Document
  const keySnapshot = await db.collection('apikeys')
    .where('value', '==', apiKey)
    .where('status', '==', 'active')
    .get();

  if (keySnapshot.empty) {
    return res.status(403).json({ error: "Invalid or disabled API key" });
  }

  const keyDoc = keySnapshot.docs[0];
  const keyData = keyDoc.data();

  // 2. Fetch User Profile to check plan limit
  const userDoc = await db.collection('users').doc(keyData.uid).get();
  if (!userDoc.exists) {
    return res.status(403).json({ error: "Associated user account not found" });
  }

  const userData = userDoc.data();
  const userPlan = (userData.plan || 'free').toLowerCase();
  const maxQuota = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;

  // 3. Enforce Quota Check
  const currentRequests = keyData.requestCount || 0;
  if (currentRequests >= maxQuota) {
    return res.status(429).json({ 
      error: `Rate limit exceeded. Your ${userPlan.toUpperCase()} plan limit is ${maxQuota.toLocaleString()} requests/month. Please upgrade your plan in the dashboard.` 
    });
  }

  // 4. Increment Request Counter
  await keyDoc.ref.update({ requestCount: admin.firestore.FieldValue.increment(1) });
  req.userPlan = userPlan;
  next();
}

// Geocoding Endpoint
app.get('/v1/geocode', validateApiKey, async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: "Missing 'address' parameter" });
  }

  try {
    const osmResponse = await axios.get(`https://nominatim.openstreetmap.org/search`, {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'RapidMaps-API-Gateway' }
    });

    if (osmResponse.data.length === 0) {
      return res.status(404).json({ error: "Address not found" });
    }

    const result = osmResponse.data[0];
    res.json({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      formatted_address: result.display_name,
      accuracy: "rooftop",
      plan: req.userPlan
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error connecting to map provider" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RapidMaps API running on port ${PORT}`));
