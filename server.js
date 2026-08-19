const path = require('path');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ================= STARTUP ENV VALIDATION =================
// Fail fast and loud instead of limping along with half-configured
// features that silently no-op in production (e.g. billing "succeeding"
// with no Razorpay keys, or every user account write throwing at runtime
// because Firebase creds were never set).
const REQUIRED_ENV = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const RECOMMENDED_ENV = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'GEMINI_API_KEY', 'EMAIL_USER', 'EMAIL_PASS'];
const missingRequired = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingRequired.length) {
  console.error(`FATAL: missing required environment variable(s): ${missingRequired.join(', ')}`);
  process.exit(1);
}
const missingRecommended = RECOMMENDED_ENV.filter((k) => !process.env[k]);
if (missingRecommended.length) {
  console.warn(`WARNING: missing optional environment variable(s), related features will be disabled: ${missingRecommended.join(', ')}`);
}

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

// Behind a platform load balancer (Render/Heroku/etc.) req.ip is otherwise
// the proxy's IP, which would make the rate limiters below apply to
// "everyone" as a single client instead of per real visitor.
app.set('trust proxy', 1);

// Security headers (HSTS, no-sniff, frame options, CSP, etc.)
// Tuned to the actual origins the frontend loads from — audited against
// index.html/app.js: Leaflet (unpkg), Chart.js (jsdelivr), Razorpay checkout,
// Firebase Auth/Firestore, OSM tiles + Nominatim, and the ibb.co logo host.
// No inline <script> blocks exist in index.html (only src=/type=module), so
// script-src does NOT need 'unsafe-inline'. Inline style="" attributes are
// still used throughout the markup, so style-src keeps 'unsafe-inline' —
// that's a much lower-severity relaxation than allowing inline scripts.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com', 'https://checkout.razorpay.com', 'https://cdn.jsdelivr.net', 'https://www.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      imgSrc: ["'self'", 'data:', 'https://i.ibb.co', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://cdn-icons-png.flaticon.com'],
      connectSrc: [
        "'self'",
        'https://nominatim.openstreetmap.org',
        'https://*.tile.openstreetmap.org',
        'https://tile.openstreetmap.org',
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
        'https://firestore.googleapis.com',
        'https://*.firebaseio.com',
        'wss://*.firebaseio.com',
        'https://api.razorpay.com',
        'https://checkout.razorpay.com',
        'https://lumberjack.razorpay.com'
      ],
      frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));

// Enable CORS and JSON body parsing (Crucial for AI Support Chat)
// The public v1 API is meant to be called from arbitrary developer
// websites using an x-api-key header (no cookies involved), so it needs to
// stay reachable cross-origin by default. CORS_ORIGINS lets an operator
// lock this down to a specific allowlist later without a code change.
// credentials stays false either way — nothing here relies on cookies, and
// combining a wide-open origin with credentials:true would be a CSRF risk.
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: configuredCorsOrigins.length ? configuredCorsOrigins : true,
  credentials: false
}));
app.use(express.json({ limit: '100kb' })); // cap body size — prevents trivial memory-exhaustion abuse

// ================= RATE LIMITING =================
// General ceiling for every route, keyed by IP.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down and try again shortly.' }
}));

// The support chat endpoint has NO authentication and calls a paid Gemini
// API on every request — without a tight, dedicated limit it's an open
// meter anyone on the internet can run up.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat messages. Please wait a moment before trying again.' }
});

// ================= API KEY GENERATION / HASHING =================
// Credentials must never be generated with Math.random() (predictable) and
// must never be stored in plaintext (a Firestore read, backup leak, or admin
// mistake would hand out live keys). We generate on the server with a CSPRNG
// and store only a SHA-256 hash — the same pattern GitHub/Stripe use for
// personal access tokens. The plaintext is returned to the browser exactly
// once, at creation/rotation time, and never persisted anywhere after that.
function generateApiKeySecret() {
  return `rm_live_${crypto.randomBytes(24).toString('base64url')}`;
}
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}
function maskApiKey(key) {
  return `${key.slice(0, 11)}${'•'.repeat(18)}${key.slice(-4)}`;
}

// ================= BILLING-PERIOD QUOTA =================
// Requests must reset every billing cycle, not accumulate forever. Rather
// than depending on a cron job to zero out counters (which silently breaks
// if the job doesn't run), each key carries the calendar period its current
// count belongs to. The very first request of a new month is treated, inside
// an atomic transaction, as "reset to 1" — correct even if traffic is bursty
// or the server restarts, and with no dependency on the nightly cron.
function currentBillingPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ================= DAILY REQUEST LIMIT (PER API KEY) =================
// The dashboard labels this field "Request limit / day" — it must actually
// be enforced, not just stored. Resets automatically at 00:00 UTC because
// the counter carries the UTC date it belongs to (same lazy-reset pattern
// as the monthly quota above), so there's no separate reset job to depend on.
function currentUtcDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ================= MAPS PROVIDER ABSTRACTION =================
// Nominatim (used below by geocodeAddress/the /v1/geocode endpoint) is a
// public, rate-limited service whose usage policy does not permit being
// resold as a paid commercial API — see the throttle/cache comments further
// down. It is kept ONLY as an explicit early-access/free-tier beta path.
// A real commercial launch needs an upstream provider whose terms permit
// resale. MAPS_PROVIDER_MODE is the single switch that flips this: nothing
// else in the app needs to change once a compliant adapter is wired in here.
const MAPS_PROVIDER_MODE = process.env.MAPS_PROVIDER_MODE === 'compliant' ? 'compliant' : 'beta';
function isCompliantMapsProviderConfigured() {
  return MAPS_PROVIDER_MODE === 'compliant';
}

// ================= PER-API-KEY RATE LIMITING =================
// IP-based limiting (below) stops one abusive visitor; it does nothing for a
// legitimate key being hammered from many IPs, or for keeping paid tiers'
// promised throughput separate from Free's. This is an in-memory sliding
// window keyed by API key hash — correct on a single Node process. If/when
// this runs on more than one instance, swap the Map for Redis (e.g.
// rate-limit-redis) so all instances share one counter.
const PLAN_RPM = { free: 60, indie: 300, builder: 1000, business: 3000, enterprise: Infinity };
const keyWindow = new Map(); // hash -> { windowStart: ms, count: number }
function checkKeyRateLimit(keyHash, plan) {
  const limit = PLAN_RPM[plan] || PLAN_RPM.free;
  if (limit === Infinity) return { ok: true };
  const now = Date.now();
  const entry = keyWindow.get(keyHash);
  if (!entry || now - entry.windowStart >= 60_000) {
    keyWindow.set(keyHash, { windowStart: now, count: 1 });
    return { ok: true };
  }
  if (entry.count >= limit) return { ok: false, retryAfterMs: 60_000 - (now - entry.windowStart) };
  entry.count += 1;
  return { ok: true };
}
// Periodically forget idle keys so this Map doesn't grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, v] of keyWindow) if (v.windowStart < cutoff) keyWindow.delete(k);
}, 5 * 60_000).unref();

// ================= NOMINATIM CACHE + THROTTLE =================
// Nominatim's usage policy caps public use at ~1 request/second and
// prohibits building a geocoding resale product directly on top of it — see
// the README note below. Caching repeat queries and serializing our own
// outbound calls to at most 1/sec is the minimum required to not get the
// server's IP banned; it is a stopgap, not a substitute for migrating to
// self-hosted Nominatim or a commercial provider whose terms permit resale
// (tracked as a launch blocker — see README).
const geocodeCache = new Map(); // normalized query -> { data, expiresAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let nominatimQueue = Promise.resolve();
function throttledNominatimGet(url, config) {
  const run = () => axios.get(url, { timeout: 5000, ...config });
  const scheduled = nominatimQueue.then(() => new Promise((resolve) => setTimeout(resolve, 1100)).then(run));
  // Chain the queue on the *settlement* of this call (ignore its error) so
  // one failed request doesn't wedge every request behind it forever.
  nominatimQueue = scheduled.then(() => undefined, () => undefined);
  return scheduled;
}
function getCached(key) {
  const hit = geocodeCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { geocodeCache.delete(key); return null; }
  return hit.data;
}
function setCached(key, data) {
  geocodeCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  if (geocodeCache.size > 5000) {
    const oldestKey = geocodeCache.keys().next().value;
    geocodeCache.delete(oldestKey);
  }
}

// ================= HTML ESCAPING (for emails built from user input) =================
// message/name/email fields end up interpolated into HTML email bodies below;
// without escaping, a crafted value could break the email markup or, on some
// mail clients, execute as active content.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
// Single source of truth for plan names, monthly quotas, and INR pricing.
// Keep this object's keys in sync with PLAN_PRICES_INR / PLAN_LIMITS_MAP in app.js.
const PLAN_LIMITS = {
  free: 2500,
  indie: 25000,
  builder: 100000,
  business: 300000,
  enterprise: Infinity
};

// Server-side authoritative price list, in paise-free INR (whole rupees).
// The frontend must never be trusted to say what a plan costs — this object
// is what /v1/create-order and /v1/verify-payment actually charge and grant.
const PLAN_PRICES_INR = {
  free:       { monthly: 0,     yearly: 0 },
  indie:      { monthly: 199,   yearly: 1910 },
  builder:    { monthly: 499,   yearly: 4790 },
  business:   { monthly: 20499, yearly: 196790 },
  enterprise: { monthly: 0,     yearly: 0 } // custom — handled via sales, never through checkout
};

// ================= SHARED KEY AUTHORIZATION LOGIC ========================
// Everything a valid, in-quota, unexpired API key request must pass —
// factored out so both the header-based public API (validateApiKey) and the
// dashboard's authenticated "test it live" playground (which must NEVER
// need the plaintext key value — see /v1/dashboard-test-geocode) share one
// implementation instead of two copies that can drift apart.
// Returns { error: { status, body } } on failure, or { userPlan } on success.
async function authorizeApiKeyDoc(keyDoc, keyHashForRateLimit) {
  const keyData = keyDoc.data();

  if (keyData.status !== 'active') {
    return { error: { status: 403, body: { error: 'Invalid or disabled API key' } } };
  }
  if (keyData.expiresAt && new Date() > new Date(keyData.expiresAt)) {
    return { error: { status: 403, body: { error: 'This API key has expired. Generate a new one from your dashboard.' } } };
  }

  const userDoc = await db.collection('users').doc(keyData.uid).get();
  if (!userDoc.exists) {
    return { error: { status: 403, body: { error: 'Associated user account not found' } } };
  }
  const userData = userDoc.data();
  const userPlan = (userData.plan || 'free').toLowerCase();

  // 1. Subscription expiry
  if (userPlan !== 'free' && userData.expiresAt) {
    const isExpired = new Date() > new Date(userData.expiresAt);
    if (isExpired && !userData.autopayEnabled) {
      sendEmail(userData.email, "Action Required: RapidMaps Subscription Expired",
        `<h2>Your ${userPlan.toUpperCase()} plan has expired.</h2>
         <p>Please log into your dashboard to renew your subscription to restore API access.</p>`);
      return {
        error: {
          status: 402,
          body: { error: `Payment Required: Your ${userPlan.toUpperCase()} subscription expired. Please log into your dashboard and complete payment to restore access.` }
        }
      };
    }
  }

  // 1b. Paid geocoding requires an upstream provider whose terms permit
  // resale. Nominatim is kept only as an explicit free-tier/early-access
  // beta path — see MAPS_PROVIDER_MODE above. Checked here, before any
  // quota is consumed, so a blocked request never costs the key a request.
  if (userPlan !== 'free' && !isCompliantMapsProviderConfigured()) {
    return {
      error: {
        status: 503,
        body: { error: 'Paid geocoding is not available yet — RapidSafe Maps has not configured a compliant production maps provider. Early-access geocoding remains available on the Free plan.' }
      }
    };
  }

  // 2. Per-key rate limit (throughput ceiling — separate from monthly quota)
  const rate = checkKeyRateLimit(keyHashForRateLimit, userPlan);
  if (!rate.ok) {
    return {
      error: {
        status: 429,
        retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000),
        body: { error: `Rate limit exceeded for the ${userPlan.toUpperCase()} plan. Slow down and retry shortly.` }
      }
    };
  }

  // 3. Atomic monthly quota check + increment, with a lazy reset at the
  // start of each billing period, inside a transaction so concurrent
  // requests can't both read the same under-quota count and both pass.
  const maxQuota = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  const period = currentBillingPeriod();
  let quotaExceeded = false;
  let dailyExceeded = false;
  let requestsAfter = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(keyDoc.ref);
    const data = snap.data();

    // Daily limit — only enforced if this key was created with one set.
    const today = currentUtcDateString();
    const dailyCountBefore = data.requestDay === today ? (data.requestCountDay || 0) : 0;
    if (data.requestLimit != null && dailyCountBefore >= data.requestLimit) {
      dailyExceeded = true;
      return;
    }

    const currentRequests = data.quotaPeriod === period ? (data.requestCount || 0) : 0;
    if (currentRequests >= maxQuota) { quotaExceeded = true; return; }
    requestsAfter = currentRequests + 1;
    tx.update(keyDoc.ref, {
      requestCount: requestsAfter,
      quotaPeriod: period,
      requestCountDay: dailyCountBefore + 1,
      requestDay: today
    });
  });

  if (dailyExceeded) {
    return {
      error: {
        status: 429,
        body: { error: `Daily request limit of ${keyData.requestLimit.toLocaleString()} reached for this API key. It resets at 00:00 UTC.` }
      }
    };
  }

  if (quotaExceeded) {
    return {
      error: {
        status: 429,
        body: { error: `Quota Exceeded: Your ${userPlan.toUpperCase()} plan limit of ${maxQuota.toLocaleString()} requests/month has been reached. It resets at the start of your next billing period.` }
      }
    };
  }

  if (requestsAfter === Math.floor(maxQuota * 0.8)) {
    sendEmail(userData.email, "RapidMaps Alert: 80% Quota Reached",
      `<p>You have used 80% of your ${maxQuota} requests for this billing period. Consider upgrading your plan to avoid service interruption.</p>`);
  }
  if (requestsAfter === maxQuota) {
    sendEmail(userData.email, "RapidMaps Alert: Quota Exceeded",
      `<p>You have reached your 100% request limit. API access is paused until your next billing period or plan upgrade.</p>`);
  }

  return { userPlan };
}

// ================= MIDDLEWARE ========================
// Checks API Key validity, per-key rate limit, Quota Limits, and Billing Expiry
async function validateApiKey(req, res, next) {
  // Header only. A key in the query string ends up in server logs, browser
  // history, proxy logs, and Referer headers — production credentials must
  // never travel that way.
  const apiKey = req.headers['x-api-key'];
  if (req.query.key && !apiKey) {
    return res.status(401).json({ error: "API keys must be sent via the 'x-api-key' header, not a query parameter." });
  }
  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-api-key header" });
  }

  // Look up key by hash — the plaintext value is never stored, so this is
  // the only way to find it, and it doubles as tamper-proof validation.
  const keyHash = hashApiKey(apiKey);
  const keySnapshot = await db.collection('apikeys')
    .where('hash', '==', keyHash)
    .where('status', '==', 'active')
    .get();

  if (keySnapshot.empty) {
    return res.status(403).json({ error: "Invalid or disabled API key" });
  }

  const keyDoc = keySnapshot.docs[0];

  // Domain restriction (optional, key-level) — mirrors the "HTTP referrer"
  // restriction pattern on Google Maps API keys. Only enforced when the
  // request actually carries an Origin/Referer header, i.e. it came from a
  // browser. A server-to-server call has neither and is let through
  // unrestricted, since there's no "website" to restrict in that case.
  const allowedDomain = keyDoc.data().allowedDomain;
  if (allowedDomain) {
    const originHeader = req.headers.origin || req.headers.referer;
    if (originHeader) {
      let originHost = null;
      try { originHost = new URL(originHeader).hostname.toLowerCase(); } catch (_) { /* malformed header */ }
      const normalizedAllowed = allowedDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      const isAllowed = originHost && (originHost === normalizedAllowed || originHost.endsWith(`.${normalizedAllowed}`));
      if (!isAllowed) {
        return res.status(403).json({ error: `This API key is restricted to ${allowedDomain} and cannot be used from this origin.` });
      }
    }
  }

  const result = await authorizeApiKeyDoc(keyDoc, keyHash);
  if (result.error) {
    if (result.error.retryAfterSeconds) res.set('Retry-After', String(result.error.retryAfterSeconds));
    return res.status(result.error.status).json(result.error.body);
  }

  req.userPlan = result.userPlan;
  next();
}

// ================= AUTH MIDDLEWARE (Firebase ID token) =================
// Verifies the caller is who they say they are before any billing or
// account-mutating endpoint runs. Never trust a `uid` sent in a request body.
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email || null;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session, please log in again' });
  }
}

// ================= ENDPOINTS =========================

// Shared by /v1/geocode and the authenticated dashboard playground so
// there's exactly one code path that talks to Nominatim.
async function geocodeAddress(address) {
  const cacheKey = `geocode:${address.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  const osmResponse = await throttledNominatimGet('https://nominatim.openstreetmap.org/search', {
    params: { q: address, format: 'json', limit: 1 },
    headers: { 'User-Agent': 'RapidMaps-API-Gateway (contact: support@rapidsafemaps.com)' }
  });

  if (osmResponse.data.length === 0) return null;

  const result = osmResponse.data[0];
  // "rooftop" is not a claim Nominatim itself makes about result precision —
  // report its actual place/type classification instead of an invented tier.
  const payload = {
    lat: parseFloat(result.lat),
    lng: parseFloat(result.lon),
    formatted_address: result.display_name,
    accuracy: result.type || result.class || 'approximate'
  };
  setCached(cacheKey, payload);
  return payload;
}

// 1. Geocoding API
// IMPORTANT: this still proxies to the public Nominatim instance. Caching +
// throttling here are stopgaps that keep the server from getting IP-banned
// under real traffic — they do NOT make reselling Nominatim results a
// compliant business model. Before charging customers for this endpoint,
// replace the upstream with self-hosted Nominatim or a commercial provider
// whose terms permit resale. See README "Launch blockers".
app.get('/v1/geocode', validateApiKey, async (req, res) => {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: "Missing 'address' parameter" });
  }
  try {
    const payload = await geocodeAddress(address);
    if (!payload) return res.status(404).json({ error: "Address not found" });
    res.json({ ...payload, plan: req.userPlan });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "Could not reach the map provider. Please retry." });
  }
});

// 1b. Dashboard "test it live" playground. This is called from the logged-in
// dashboard, authenticated with the user's Firebase session — NOT with an
// x-api-key. It exists so the browser never needs to read a plaintext API
// key value out of Firestore (it can't — only a hash is stored) just to run
// a demo search. It looks up the caller's own active key server-side, runs
// it through the exact same authorization + quota logic as the public API,
// and consumes one real request from that key.
app.get('/v1/dashboard-test-geocode', requireAuth, async (req, res) => {
  const { address } = req.query;
  if (!address) {
    return res.status(400).json({ error: "Missing 'address' parameter" });
  }
  try {
    const keysSnap = await db.collection('apikeys')
      .where('uid', '==', req.uid)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (keysSnap.empty) {
      return res.status(400).json({ error: 'No active API key. Generate one from the dashboard first.' });
    }
    const keyDoc = keysSnap.docs[0];
    const result = await authorizeApiKeyDoc(keyDoc, keyDoc.data().hash);
    if (result.error) {
      if (result.error.retryAfterSeconds) res.set('Retry-After', String(result.error.retryAfterSeconds));
      return res.status(result.error.status).json(result.error.body);
    }
    const payload = await geocodeAddress(address);
    if (!payload) return res.status(404).json({ error: 'Address not found' });

    // Written server-side (Admin SDK, bypasses Firestore rules) so the
    // dashboard's "recent requests" panel has something to read — the
    // client is not allowed to write to `usage` directly (see rules).
    db.collection('usage').add({
      uid: req.uid,
      endpoint: '/v1/geocode',
      statusCode: 200,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    }).catch((e) => console.error('usage log write failed:', e));

    res.json({ ...payload, plan: result.userPlan });
  } catch (error) {
    console.error('Dashboard test geocode failed:', error);
    res.status(502).json({ error: 'Could not reach the map provider. Please retry.' });
  }
});

// ================= NOT-YET-IMPLEMENTED MAP ENDPOINTS =================
// The docs advertise these because they're part of the intended API
// surface, but there is no upstream integration behind them yet — Nominatim
// doesn't cover them, and no commercial provider adapter is wired in (see
// the MAPS_PROVIDER_MODE abstraction above). Rather than fake results,
// they fail loudly and explicitly with a 503 and a clear reason. They
// don't run validateApiKey/consume quota, since they never do any real
// work — no point charging a key's request budget for a guaranteed failure.
function notYetAvailable(name) {
  return (req, res) => {
    res.status(503).json({
      error: `${name} is not available yet. RapidSafe Maps has not configured a maps provider for this endpoint.`,
      status: 'not_implemented'
    });
  };
}
app.get('/v1/reverse', notYetAvailable('Reverse geocoding'));
app.get('/v1/autocomplete', notYetAvailable('Autocomplete'));
app.get('/v1/places/search', notYetAvailable('Places search'));
app.get('/v1/directions', notYetAvailable('Directions'));
app.post('/v1/matrix', notYetAvailable('Matrix'));
app.get('/v1/staticmap', notYetAvailable('Static maps'));
app.get('/v1/elevation', notYetAvailable('Elevation'));
app.get('/v1/timezone', notYetAvailable('Timezone'));

// ================= GOOGLE-COMPATIBLE MIGRATION ENDPOINT =================
app.get('/maps/api/geocode/json', validateApiKey, async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ status: "INVALID_REQUEST", error_message: "Missing address" });
  }

  const cacheKey = `google-geocode:${address.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const osmResponse = await throttledNominatimGet('https://nominatim.openstreetmap.org/search', {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'RapidMaps-API-Gateway (contact: support@rapidsafemaps.com)' }
    });

    if (osmResponse.data.length === 0) {
      return res.json({ results: [], status: "ZERO_RESULTS" });
    }

    const result = osmResponse.data[0];

    // Transform our data to mimic Google's JSON structure. Report the
    // provider's own place classification rather than always claiming
    // ROOFTOP, which Nominatim does not guarantee.
    const payload = {
      results: [
        {
          formatted_address: result.display_name,
          geometry: {
            location: {
              lat: parseFloat(result.lat),
              lng: parseFloat(result.lon)
            },
            location_type: (result.type || result.class || 'approximate').toUpperCase()
          },
          place_id: `rm_id_${result.place_id}`
        }
      ],
      status: "OK"
    };
    setCached(cacheKey, payload);
    res.json(payload);

  } catch (error) {
    console.error(error);
    res.status(502).json({ status: "UNKNOWN_ERROR" });
  }
});

// 2. AI Support Chat Endpoint
// Requires auth: an unauthenticated endpoint calling a paid AI API is an
// open meter for anyone on the internet to run up. The IP-based chatLimiter
// still applies as a first line of defense; requireAuth + per-user limiting
// stop the "many accounts/proxies" bypass, and the plan is looked up from
// Firestore rather than trusted from the request body.
app.post('/v1/support-chat', chatLimiter, requireAuth, async (req, res) => {
  const { message, history = [] } = req.body;

  const chatRate = checkKeyRateLimit(`chat:${req.uid}`, 'free'); // 60/min per user ceiling, independent of IP
  if (!chatRate.ok) {
    return res.status(429).json({ error: 'Too many messages from your account. Please wait a moment.' });
  }

  let plan = 'free';
  try {
    const userDoc = await db.collection('users').doc(req.uid).get();
    if (userDoc.exists) plan = (userDoc.data().plan || 'free').toLowerCase();
  } catch (_) { /* fall back to 'free' persona context on lookup failure */ }

  if (!genAI) {
    return res.json({ reply: "AI Support is currently offline. GEMINI_API_KEY is missing on the server." });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: "Missing 'message' field" });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: "Message is too long (4000 character limit)." });
  }

  try {
    // NOTE: verify this model name against the current Gemini API docs
    // before launch — model names/versions are retired on a rolling basis
    // and an invalid name will make every support-chat request fail.
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Safely format the chat history for Gemini's memory
    const formattedHistory = history.map(msg => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.text || " " }]
    }));

    const chat = model.startChat({
      history: formattedHistory
    });

    // Inject the persona rules invisibly into the very first message of the conversation
        // Inject the persona rules invisibly into the very first message of the conversation
    const systemRules = `[System Instructions: You are the 24/7 AI Technical Support Agent for RapidSafe Maps. 
    
    CRUCIAL FACTS YOU MUST KNOW: 
    1. RapidSafe Maps was built entirely by one single software engineer and CEO named Mohammed Saqib Ahmed. 
    2. There is no "team" — Mohammed Saqib Ahmed is the sole founder and creator.
    
    RULES FOR SPEED:
    1. You must respond as fast as possible.
    2. Keep your answers extremely short and concise (1 to 2 sentences maximum). Do not write long paragraphs.
    3. The user is on the "${plan || 'free'}" plan.]\n\n`;
    
    const finalMessage = formattedHistory.length === 0 ? (systemRules + message) : message;

    const result = await chat.sendMessage(finalMessage);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Gemini Error Details:", err);
    res.status(500).json({ reply: `API Error: ${err.message || 'Unknown connection issue'}` });
  }
});

// 3. Human Escalation Endpoint (Business & Enterprise Only)
app.post('/v1/escalate-support', requireAuth, async (req, res) => {
  const { message } = req.body;
  const uid = req.uid;

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User profile not found" });
    const userData = userDoc.data();
    const plan = (userData.plan || 'free').toLowerCase();

    // Block Free, Indie, and Builder users from live human chat
    if (plan !== 'business' && plan !== 'enterprise') {
      return res.status(403).json({ error: "24/7 Human Support is only available on Business and Enterprise plans. Please upgrade your plan." });
    }

    const alertHtml = `
      <h2>URGENT: Premium Support Request</h2>
      <p><strong>Plan:</strong> ${escapeHtml(plan.toUpperCase())}</p>
      <p><strong>User:</strong> ${escapeHtml(req.userEmail || userData.email)} (${escapeHtml(userData.name)})</p>
      <p><strong>Message:</strong> ${escapeHtml(message || 'Requested live agent.')}</p>
      <p>Please contact them immediately or join the live support terminal.</p>
    `;
    
    await sendEmail(process.env.EMAIL_USER, `[PRIORITY] ${plan.toUpperCase()} Support Request`, alertHtml);

    res.json({ success: true, message: "Your priority support request was emailed to the RapidMaps support inbox. Response times are not guaranteed." });
  } catch (error) {
    res.status(500).json({ error: "Failed to connect to human agent." });
  }
});

// 4. Create a Razorpay order (server decides the price — never the client)
app.post('/v1/create-order', requireAuth, async (req, res) => {
  const plan = (req.body.planKey || '').toLowerCase();
  const billingCycle = req.body.cycle === 'yearly' ? 'yearly' : 'monthly';

  if (!PLAN_PRICES_INR[plan] || plan === 'free' || plan === 'enterprise') {
    return res.status(400).json({ error: 'Invalid or non-purchasable plan' });
  }
  const amountINR = PLAN_PRICES_INR[plan][billingCycle];
  if (!amountINR || amountINR <= 0) {
    return res.status(400).json({ error: 'Invalid plan amount' });
  }
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: 'Payments are not configured on the server.' });
  }

  try {
    const orderResp = await axios.post('https://api.razorpay.com/v1/orders', {
      amount: amountINR * 100, // paise
      currency: 'INR',
      receipt: `rs_${req.uid}_${Date.now()}`,
      notes: { uid: req.uid, plan, cycle: billingCycle }
    }, {
      auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_KEY_SECRET }
    });

    res.json({
      orderId: orderResp.data.id,
      amount: orderResp.data.amount,
      currency: orderResp.data.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan,
      cycle: billingCycle
    });
  } catch (error) {
    console.error('Razorpay order creation failed:', error.response?.data || error.message);
    res.status(502).json({ error: 'Could not create payment order. Please try again.' });
  }
});

// 5. Verify a completed Razorpay payment and activate the plan.
// This is the ONLY place a paid plan gets written to Firestore. The old
// client-side flow that wrote `plan` directly from the browser after the
// Razorpay `handler` callback fired has been removed — that let anyone open
// devtools and grant themselves an Enterprise plan for free.
app.post('/v1/verify-payment', requireAuth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const plan = (req.body.planKey || '').toLowerCase();
  const billingCycle = req.body.cycle === 'yearly' ? 'yearly' : 'monthly';

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }
  if (!PLAN_PRICES_INR[plan] || plan === 'free' || plan === 'enterprise') {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  if (!process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: 'Payments are not configured on the server.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  // A valid signature only proves the person holds a genuinely-signed
  // (order_id, payment_id) pair — it does NOT prove which plan/cycle/amount
  // that pair was actually created for. Without this step, someone who pays
  // ₹199 for Indie could resubmit that same valid signature with
  // planKey: "business" and get the ₹20,499 tier for free. We must fetch the
  // order back from Razorpay and independently confirm it matches what the
  // client is now claiming to have bought.
  const amountINR = PLAN_PRICES_INR[plan][billingCycle];
  let order, payment;
  try {
    const auth = { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_KEY_SECRET };
    [order, payment] = await Promise.all([
      axios.get(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, { auth, timeout: 8000 }).then(r => r.data),
      axios.get(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, { auth, timeout: 8000 }).then(r => r.data)
    ]);
  } catch (error) {
    console.error('Razorpay order/payment fetch failed:', error.response?.data || error.message);
    return res.status(502).json({ error: 'Could not verify payment with Razorpay. Please contact support with your payment ID.' });
  }

  const notes = order.notes || {};
  const mismatches = [];
  if (notes.uid !== req.uid) mismatches.push('account');
  if (notes.plan !== plan) mismatches.push('plan');
  if (notes.cycle !== billingCycle) mismatches.push('billing cycle');
  if (order.amount !== amountINR * 100) mismatches.push('amount');
  if (payment.order_id !== razorpay_order_id) mismatches.push('payment/order link');
  if (payment.status !== 'captured') mismatches.push('payment status');

  if (mismatches.length) {
    console.error('Payment verification mismatch:', { uid: req.uid, plan, billingCycle, mismatches, orderNotes: notes });
    return res.status(400).json({ error: 'This payment does not match the requested plan. Contact support with your payment ID.' });
  }

  const now = new Date();
  const expiryDate = new Date();
  if (billingCycle === 'yearly') expiryDate.setFullYear(now.getFullYear() + 1);
  else expiryDate.setMonth(now.getMonth() + 1);

  // Idempotency: a payment_id must activate a plan at most once. A
  // transaction that create()s a doc keyed by the payment_id is atomic —
  // Firestore rejects the second attempt if the doc already exists, so a
  // retried/replayed request (network retry, duplicate webhook-style call,
  // or someone resending the same signed payload) can't grant the plan twice.
  const processedRef = db.collection('processedPayments').doc(razorpay_payment_id);
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(processedRef);
      if (existing.exists) {
        throw Object.assign(new Error('ALREADY_PROCESSED'), { code: 'ALREADY_PROCESSED' });
      }
      tx.set(processedRef, {
        uid: req.uid,
        plan,
        billingCycle,
        amountINR,
        orderId: razorpay_order_id,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(db.collection('users').doc(req.uid), {
        plan,
        billingCycle,
        amountINR,
        paymentStatus: 'PAID',
        lastPaymentId: razorpay_payment_id,
        lastOrderId: razorpay_order_id,
        paidAt: now.toISOString(),
        expiresAt: expiryDate.toISOString(),
        updatedAt: now.toISOString(),
        // Always false: there is no real Razorpay recurring
        // subscription/mandate implementation yet, so we never record (or
        // trust) a client claim that AutoPay is on. See README "AutoPay"
        // note — this must change only once actual recurring billing exists.
        autopayEnabled: false
      }, { merge: true });
    });

    await db.collection('usage').add({
      uid: req.uid,
      endpoint: `/billing/razorpay-${plan}`,
      statusCode: 200,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, plan, billingCycle, expiresAt: expiryDate.toISOString() });
  } catch (error) {
    if (error.code === 'ALREADY_PROCESSED') {
      return res.status(409).json({ error: 'This payment has already been applied to an account.' });
    }
    console.error('Failed to persist verified plan upgrade:', error);
    res.status(500).json({ error: 'Payment verified but we could not update your account. Contact support with your payment ID.' });
  }
});

// 6. Free plan needs no payment, but should still go through the server so
// a user can't set arbitrary fields (autopay, paymentStatus, etc.) on their own doc.
app.post('/v1/activate-free-plan', requireAuth, async (req, res) => {
  try {
    await db.collection('users').doc(req.uid).set({
      plan: 'free',
      billingCycle: 'monthly',
      amountINR: 0,
      paymentStatus: 'FREE',
      expiresAt: null,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    res.json({ success: true, plan: 'free' });
  } catch (error) {
    res.status(500).json({ error: 'Could not switch to the Free plan.' });
  }
});

// 7. API key lifecycle — creation, rotation, status toggle, deletion.
// These now live entirely server-side. The browser never generates or
// transmits the plaintext key except in this endpoint's own response, and
// Firestore never stores anything but the hash + a display mask.
app.post('/v1/api-keys', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || 'Untitled key').slice(0, 80);
    const allowedDomain = String(req.body.allowedDomain || '').slice(0, 200);
    const requestLimit = Number.isFinite(req.body.requestLimit) ? req.body.requestLimit : null;
    const expiresAt = req.body.expiresAt || null;

    const secret = generateApiKeySecret();
    const docRef = await db.collection('apikeys').add({
      uid: req.uid,
      name,
      allowedDomain,
      requestLimit,
      expiresAt,
      hash: hashApiKey(secret),
      maskedKey: maskApiKey(secret),
      status: 'active',
      requestCount: 0,
      quotaPeriod: currentBillingPeriod(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // `key` is the ONLY time the plaintext value ever leaves the server.
    res.json({ id: docRef.id, key: secret, maskedKey: maskApiKey(secret) });
  } catch (error) {
    console.error('API key creation failed:', error);
    res.status(500).json({ error: 'Could not create API key.' });
  }
});

app.post('/v1/api-keys/:id/rotate', requireAuth, async (req, res) => {
  try {
    const ref = db.collection('apikeys').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.uid) {
      return res.status(404).json({ error: 'API key not found' });
    }
    const secret = generateApiKeySecret();
    await ref.update({
      hash: hashApiKey(secret),
      maskedKey: maskApiKey(secret),
      requestCount: 0,
      quotaPeriod: currentBillingPeriod()
    });
    res.json({ id: req.params.id, key: secret, maskedKey: maskApiKey(secret) });
  } catch (error) {
    console.error('API key rotation failed:', error);
    res.status(500).json({ error: 'Could not rotate API key.' });
  }
});

app.patch('/v1/api-keys/:id', requireAuth, async (req, res) => {
  try {
    const ref = db.collection('apikeys').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.uid) {
      return res.status(404).json({ error: 'API key not found' });
    }
    const status = req.body.status === 'disabled' ? 'disabled' : 'active';
    await ref.update({ status });
    res.json({ id: req.params.id, status });
  } catch (error) {
    console.error('API key status update failed:', error);
    res.status(500).json({ error: 'Could not update API key.' });
  }
});

app.delete('/v1/api-keys/:id', requireAuth, async (req, res) => {
  try {
    const ref = db.collection('apikeys').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.uid) {
      return res.status(404).json({ error: 'API key not found' });
    }
    await ref.delete();
    res.json({ success: true });
  } catch (error) {
    console.error('API key deletion failed:', error);
    res.status(500).json({ error: 'Could not delete API key.' });
  }
});

// ================= DAILY CRON JOB ====================
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily usage reports...');
  try {
    const usersSnap = await db.collection('users').get();

    // forEach does not await its async callback, so failures here used to
    // become silent unhandled promise rejections and one bad user record
    // could never be distinguished from the rest. Use a plain for-of loop
    // (sequential — fine for a nightly job) and isolate each user's errors.
    for (const userDoc of usersSnap.docs) {
      try {
        const userData = userDoc.data();
        if (!userData.email) continue;

        // Get user's API keys to calculate total requests
        const keysSnap = await db.collection('apikeys').where('uid', '==', userDoc.id).get();
        let totalRequests = 0;
        keysSnap.forEach(key => { totalRequests += (key.data().requestCount || 0); });

        const userPlan = (userData.plan || 'free').toLowerCase();
        const maxQuota = PLAN_LIMITS[userPlan] || 2500;

        const emailHtml = `
          <h2>RapidMaps Daily Report</h2>
          <p>Hello ${escapeHtml(userData.name)},</p>
          <p>Here is your current API usage summary:</p>
          <ul>
            <li><strong>Current Plan:</strong> ${escapeHtml(userPlan.toUpperCase())}</li>
            <li><strong>Total Requests Used:</strong> ${totalRequests.toLocaleString()}</li>
            <li><strong>Remaining Quota:</strong> ${(maxQuota === Infinity ? '∞' : (maxQuota - totalRequests).toLocaleString())}</li>
          </ul>
          <p>Log in to your dashboard to view detailed analytics.</p>
        `;

        // Only send if they've actually used the API to prevent spamming inactive users
        if (totalRequests > 0) {
          await sendEmail(userData.email, "Your RapidMaps Daily Usage Report", emailHtml);
        }
      } catch (perUserError) {
        console.error(`Daily report failed for user ${userDoc.id}:`, perUserError);
        // continue on to the next user rather than aborting the whole run
      }
    }
  } catch (error) {
    console.error('Cron Job Error:', error);
  }
});
// =====================================================

// ================= HEALTH CHECK =================
// Used by the hosting platform / uptime monitors to know the process is
// alive, and by the frontend to show honest configuration status. Only
// booleans/timestamps — never secrets or credential values.
app.get('/health', (req, res) => res.status(200).json({
  status: 'ok',
  service: 'RapidMaps API',
  timestamp: new Date().toISOString(),
  paymentsConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  aiConfigured: !!genAI,
  compliantMapsProviderConfigured: isCompliantMapsProviderConfigured()
}));

// ============================================================
// SERVE THE FRONTEND FILES
// ============================================================
// (cors + express.json() are already registered once, at the top of this file)
app.use(express.static(__dirname));

// When someone visits the main URL, explicitly send them index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// Client-side router (page-landing / page-dashboard / etc. all live inside
// index.html) — so any unmatched non-API route should also fall back to it,
// otherwise a hard refresh on a deep link 404s.
app.get(/^\/(?!v1\/|maps\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// ============================================================

// ================= CENTRAL ERROR HANDLER =================
// Catches anything thrown/rejected in a route that wasn't already handled
// locally, so a bug returns a clean JSON 500 instead of Express's default
// HTML error page (which can leak stack traces in some configurations).
// ================= SEO DOMAIN REDIRECT =================
// Permanently redirects legacy Firebase URLs and the naked domain
// directly to www.rapidsafe.in to fix Googlebot indexing loops.
app.use((req, res, next) => {
  const host = req.hostname || '';
  if (host.includes('web.app') || host.includes('firebaseapp.com') || host === 'rapidsafe.in') {
    return res.redirect(301, `https://www.rapidsafe.in${req.originalUrl}`);
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RapidMaps API running on port ${PORT}`));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
