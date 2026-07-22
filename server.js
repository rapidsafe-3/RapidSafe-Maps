const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');

// 1. Use Environment Variables for security
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
  })
});

const db = admin.firestore();
const app = express();

// Middleware to check the API Key
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  const keySnapshot = await db.collection('apikeys')
    .where('value', '==', apiKey)
    .where('status', '==', 'active')
    .get();

  if (keySnapshot.empty) {
    return res.status(403).json({ error: "Invalid or disabled API key" });
  }

  const keyDoc = keySnapshot.docs[0];
  await keyDoc.ref.update({ requestCount: admin.firestore.FieldValue.increment(1) });
  next();
}

app.get('/v1/geocode', validateApiKey, async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing 'address' parameter" });

  try {
    const osmResponse = await axios.get(`https://nominatim.openstreetmap.org/search`, {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'RapidMaps-API-Gateway' }
    });

    if (osmResponse.data.length === 0) return res.status(404).json({ error: "Address not found" });

    const result = osmResponse.data[0];
    res.json({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      formatted_address: result.display_name,
      accuracy: "rooftop"
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error connecting to map provider" });
  }
});

// 2. Use a dynamic port assigned by the host
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RapidMaps API running on port ${PORT}`));
