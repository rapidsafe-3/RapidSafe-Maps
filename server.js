const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ================= FIREBASE INITIALIZATION =================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
  })
});

const db = admin.firestore();
const app = express();

// Enable CORS and JSON body parsing (Crucial for AI Support Chat)
app.use(cors());
app.use(express.json()); 

// ================= EMAIL TRANSPORTER =================
const transporter = nodemailer.createTransport({
  service: 'gmail', 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS 
  }
});

async function sendEmail(to, subject, htmlContent) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn("Email credentials missing. Skipping email to:", to);
    return;
  }
  
  try {
    await transporter.sendMail({
      from: `"RapidMaps Support" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: htmlContent
    });
    console.log(`Email sent successfully to ${to}`);
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
  }
}

// ================= GEMINI AI SETUP ===================
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// ================= PLAN LIMITS =======================
const PLAN_LIMITS = {
  free: 2500,
  starter: 50000,
  pro: 500000,
  business: 3000000,
  enterprise: Infinity
};

// ================= MIDDLEWARE ========================
// Checks API Key validity, Quota Limits, and Billing Expiry
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  // Look up key in Firestore
  const keySnapshot = await db.collection('apikeys')
    .where('value', '==', apiKey)
    .where('status', '==', 'active')
    .get();

  if (keySnapshot.empty) {
    return res.status(403).json({ error: "Invalid or disabled API key" });
  }

  const keyDoc = keySnapshot.docs[0];
  const keyData = keyDoc.data();

  // Fetch User Profile
  const userDoc = await db.collection('users').doc(keyData.uid).get();
  if (!userDoc.exists) {
    return res.status(403).json({ error: "Associated user account not found" });
  }

  const userData = userDoc.data();
  const userPlan = (userData.plan || 'free').toLowerCase();

  // 1. Check Subscription Expiry Date
  if (userPlan !== 'free' && userData.expiresAt) {
    const isExpired = new Date() > new Date(userData.expiresAt);
    if (isExpired && !userData.autopayEnabled) {
      
      sendEmail(userData.email, "Action Required: RapidMaps Subscription Expired", 
        `<h2>Your ${userPlan.toUpperCase()} plan has expired.</h2>
         <p>Please log into your dashboard to renew your subscription or enable AutoPay to restore API access.</p>`);
         
      return res.status(402).json({ 
        error: `Payment Required: Your ${userPlan.toUpperCase()} subscription expired. Please log into your dashboard and complete payment or enable AutoPay.` 
      });
    }
  }

  const maxQuota = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  const currentRequests = keyData.requestCount || 0;

  // 2. Trigger 80% Usage Alert Email
  if (currentRequests === Math.floor(maxQuota * 0.8)) {
    sendEmail(userData.email, "RapidMaps Alert: 80% Quota Reached", 
      `<p>You have used 80% of your ${maxQuota} requests for the month. Consider upgrading your plan to avoid service interruption.</p>`);
  }

  // 3. Check Quota Limits (100%)
  if (currentRequests >= maxQuota) {
    if (currentRequests === maxQuota) {
      sendEmail(userData.email, "RapidMaps Alert: Quota Exceeded", 
        `<p>You have reached your 100% request limit. API access is currently paused until your next billing cycle or plan upgrade.</p>`);
    }
    return res.status(429).json({ 
      error: `Quota Exceeded: Your ${userPlan.toUpperCase()} plan limit of ${maxQuota.toLocaleString()} requests/month has been reached.` 
    });
  }

  // Record usage (increment request count)
  await keyDoc.ref.update({ requestCount: admin.firestore.FieldValue.increment(1) });
  req.userPlan = userPlan;
  
  next();
}

// ================= ENDPOINTS =========================

// 1. Geocoding API
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

// 2. AI Support Chat Endpoint (WITH MEMORY & ERRORS)
app.post('/v1/support-chat', async (req, res) => {
  const { message, plan, history = [] } = req.body;
  
  if (!genAI) {
    return res.json({ reply: "AI Support is currently offline. GEMINI_API_KEY is missing on the server." });
  }

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: `You are the 24/7 AI Technical Support Agent for RapidMaps. The user is currently on the "${plan || 'free'}" plan. Be helpful, brief, and provide code snippets if they ask about geocoding, autocomplete, or matrix APIs. If they ask about billing, tell them to check their dashboard or upgrade their plan.`
    });

    // Safely format the chat history for Gemini's memory
    const formattedHistory = history.map(msg => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.text || " " }]
    }));

    const chat = model.startChat({
      history: formattedHistory
    });

    const result = await chat.sendMessage(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Gemini Error Details:", err);
    // Print the EXACT error from Google directly into the chat window
    res.status(500).json({ reply: `API Error: ${err.message || 'Unknown connection issue'}` });
  }
});

// 3. Human Escalation Endpoint (Business & Enterprise Only)
app.post('/v1/escalate-support', async (req, res) => {
  const { uid, userEmail, message } = req.body;

  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const plan = (userData.plan || 'free').toLowerCase();

    // Block Free, Starter, and Pro users from live human chat
    if (plan !== 'business' && plan !== 'enterprise') {
      return res.status(403).json({ error: "24/7 Human Support is only available on Business and Enterprise plans. Please upgrade your plan." });
    }

    const alertHtml = `
      <h2>URGENT: Premium Support Request</h2>
      <p><strong>Plan:</strong> ${plan.toUpperCase()}</p>
      <p><strong>User:</strong> ${userEmail} (${userData.name})</p>
      <p><strong>Message:</strong> ${message || 'Requested live agent.'}</p>
      <p>Please contact them immediately or join the live support terminal.</p>
    `;
    
    await sendEmail(process.env.EMAIL_USER, `[PRIORITY] ${plan.toUpperCase()} Support Request`, alertHtml);

    res.json({ success: true, message: "A dedicated human agent has been notified and will join the chat or email you within 5 minutes." });
  } catch (error) {
    res.status(500).json({ error: "Failed to connect to human agent." });
  }
});

// ================= DAILY CRON JOB ====================
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily usage reports...');
  try {
    const usersSnap = await db.collection('users').get();
    
    usersSnap.forEach(async (userDoc) => {
      const userData = userDoc.data();
      if (!userData.email) return;

      // Get user's API keys to calculate total requests
      const keysSnap = await db.collection('apikeys').where('uid', '==', userDoc.id).get();
      let totalRequests = 0;
      keysSnap.forEach(key => { totalRequests += (key.data().requestCount || 0); });

      const userPlan = (userData.plan || 'free').toLowerCase();
      const maxQuota = PLAN_LIMITS[userPlan] || 2500;

      const emailHtml = `
        <h2>RapidMaps Daily Report</h2>
        <p>Hello ${userData.name},</p>
        <p>Here is your current API usage summary:</p>
        <ul>
          <li><strong>Current Plan:</strong> ${userPlan.toUpperCase()}</li>
          <li><strong>Total Requests Used:</strong> ${totalRequests.toLocaleString()}</li>
          <li><strong>Remaining Quota:</strong> ${(maxQuota - totalRequests).toLocaleString()}</li>
        </ul>
        <p>Log in to your dashboard to view detailed analytics.</p>
      `;

      // Only send if they've actually used the API to prevent spamming inactive users
      if (totalRequests > 0) {
        await sendEmail(userData.email, "Your RapidMaps Daily Usage Report", emailHtml);
      }
    });
  } catch (error) {
    console.error('Cron Job Error:', error);
  }
});
// =====================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RapidMaps API running on port ${PORT}`));
