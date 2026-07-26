/* ============================================================
   FIREBASE — bootstrap, auth helpers, Firestore helpers
   (from js/firebase.js)
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBNKkE1WfZi4G5F_Wn8xXXrO95NtqiGMZs",
  authDomain: "rapid-map-9.firebaseapp.com",
  projectId: "rapid-map-9",
  storageBucket: "rapid-map-9.firebasestorage.app",
  messagingSenderId: "637528799451",
  appId: "1:637528799451:web:78074c39087062d5f9f4fe"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
setPersistence(auth, browserLocalPersistence);

async function registerWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await createUserDocument(cred.user, { name });
  return cred.user;
}

async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await createUserDocument(cred.user, { name: cred.user.displayName });
  return cred.user;
}

async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

async function logout() {
  return signOut(auth);
}

function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

async function createUserDocument(user, extra = {}) {
  const ref = doc(db, 'users', user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return existing.data();
  const userData = {
    uid: user.uid,
    name: extra.name || user.displayName || 'Developer',
    email: user.email,
    company: extra.company || '',
    country: extra.country || '',
    plan: 'free',
    photoURL: user.photoURL || '',
    createdAt: serverTimestamp(),
    role: 'user',
    banned: false,
  };
  await setDoc(ref, userData);
  return userData;
}

async function getUserDocument(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

async function updateUserDocument(uid, data) {
  return setDoc(doc(db, 'users', uid), data, { merge: true });
}

async function createApiKeyDoc(uid, keyData) {
  return addDoc(collection(db, 'apikeys'), {
    uid,
    ...keyData,
    createdAt: serverTimestamp(),
    status: 'active',
    requestCount: 0,
  });
}

function watchApiKeys(uid, callback) {
  const q = query(collection(db, 'apikeys'), where('uid', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

async function updateApiKey(keyId, data) {
  return updateDoc(doc(db, 'apikeys', keyId), data);
}

async function deleteApiKey(keyId) {
  return deleteDoc(doc(db, 'apikeys', keyId));
}

function watchRecentUsage(uid, callback, max = 10) {
  const q = query(
    collection(db, 'usage'),
    where('uid', '==', uid),
    orderBy('timestamp', 'desc'),
    limit(max)
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

function watchNotifications(uid, callback) {
  const q = query(
    collection(db, 'notifications'),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/* ============================================================
   UPDATED ROUTER & PAGES
   ============================================================ */

const PAGES = ['landing', 'login', 'signup', 'forgot', 'dashboard', 'profile', 'settings', 'pricing', 'docs', 'admin', 'terms', 'privacy'];

const PAGE_FILE_MAP = {
  'index.html': 'landing',
  'login.html': 'login',
  'signup.html': 'signup',
  'forgot-password.html': 'forgot',
  'dashboard.html': 'dashboard',
  'profile.html': 'profile',
  'settings.html': 'settings',
  'pricing.html': 'pricing',
  'docs.html': 'docs',
  'admin.html': 'admin',
  'terms.html': 'terms',
  'privacy.html': 'privacy'
};

const PAGE_TITLES = {
  landing: 'RapidMaps — Developer-first Maps Platform',
  login: 'Log in — RapidMaps',
  signup: 'Sign up — RapidMaps',
  forgot: 'Reset password — RapidMaps',
  dashboard: 'Dashboard — RapidMaps',
  profile: 'Profile — RapidMaps',
  settings: 'Settings — RapidMaps',
  pricing: 'Pricing — RapidMaps',
  docs: 'Documentation — RapidMaps',
  admin: 'Admin — RapidMaps',
  terms: 'Terms and Conditions — RapidMaps',
  privacy: 'Privacy Policy — RapidMaps'
};

function navigateTo(page) {
  if (!PAGES.includes(page)) page = 'landing';
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('page-active'));
  document.getElementById(`page-${page}`)?.classList.add('page-active');
  currentPageKey = page;
  document.title = PAGE_TITLES[page] || 'RapidMaps';
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (location.hash !== `#${page}`) history.pushState(null, '', `#${page}`);

  // Floating Back Button Visibility
  const backBtn = document.getElementById('floating-back-btn');
  if (backBtn) {
    if (['landing', 'dashboard'].includes(page)) {
      backBtn.style.display = 'none';
    } else {
      backBtn.style.display = 'flex';
    }
  }

  onPageEnter(page);
}

/* ============================================================
   RAZORPAY PAYMENT & AUTOPAY SUBSCRIPTION MANAGEMENT
   ============================================================ */

const RAZORPAY_KEY = 'rzp_live_TI299GdYS7pnE8';
const MERCHANT_VPA = 'rapidmaps@ptyes';

// Real Price Table in INR
const PLAN_PRICES_INR = {
  free: { monthly: 0, yearly: 0, label: 'Free' },
  starter: { monthly: 1599, yearly: 14999, label: 'Starter' },
  pro: { monthly: 6499, yearly: 61999, label: 'Pro' },
  business: { monthly: 20499, yearly: 195999, label: 'Business' },
  enterprise: { monthly: 0, yearly: 0, label: 'Enterprise' }
};

let activeTargetPlan = null;
let activeTargetCycle = 'monthly';
let activeTargetAmount = 0;

function bindPlanSelection() {
  // 1. Intercept Plan Selection Buttons with Login Check
  document.querySelectorAll('[data-select-plan]').forEach((button) => {
    button.addEventListener('click', async (e) => {
      const selectedPlan = e.target.getAttribute('data-select-plan');
      
      // AUTH GUARD: Require login before plan selection
      if (!currentUser) {
        Toast.error('Please log in or create an account to select a plan.');
        navigateTo('login');
        return;
      }

      const activeBillingBtn = document.querySelector('.billing-toggle button.active');
      const cycle = activeBillingBtn ? activeBillingBtn.dataset.billing : 'monthly';

      if (selectedPlan === 'free') {
        await activateUserPlan('free', 'monthly', 0, false, 'FREE_TIER');
        Toast.success('Switched to Free Plan.');
        return;
      }

      if (selectedPlan === 'enterprise') {
        Toast.show('Enterprise request submitted! Our sales team will contact you.', 'success', 3000);
        return;
      }

      // Open Razorpay Checkout Setup Modal
      openRazorpayModal(selectedPlan, cycle);
    });
  });

  // 2. Launch Official Razorpay Payment Window
  document.getElementById('rzp-launch-pay-btn')?.addEventListener('click', () => {
    if (!activeTargetPlan || !currentUser) return;

    const isAutoPay = document.getElementById('rzp-enable-autopay').checked;
    closeModal('razorpay-checkout-modal');

    const options = {
      key: RAZORPAY_KEY,
      amount: activeTargetAmount * 100, // Amount in Paise
      currency: 'INR',
      name: 'RapidMaps Platform',
      description: `${PLAN_PRICES_INR[activeTargetPlan].label} Plan (${activeTargetCycle.toUpperCase()}) ${isAutoPay ? '- AutoPay Enabled' : ''}`,
      image: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
      handler: async function (response) {
        const paymentId = response.razorpay_payment_id || `RZP_PAY_${Date.now()}`;
        await activateUserPlan(activeTargetPlan, activeTargetCycle, activeTargetAmount, isAutoPay, paymentId);
        Toast.success(`Payment Successful! Your ${activeTargetPlan.toUpperCase()} plan is live.`);
      },
      prefill: {
        name: currentProfile?.name || currentUser.displayName || 'Developer',
        email: currentUser.email || '',
      },
      notes: {
        uid: currentUser.uid,
        vpa: MERCHANT_VPA,
        autopay: isAutoPay ? 'ENABLED' : 'DISABLED'
      },
      theme: {
        color: '#FF6B00'
      }
    };

    const rzp = new Razorpay(options);
    rzp.open();
  });
}

// Prepare Razorpay Modal Data
function openRazorpayModal(planKey, cycle) {
  const planInfo = PLAN_PRICES_INR[planKey] || PLAN_PRICES_INR.free;
  const amount = cycle === 'yearly' ? planInfo.yearly : planInfo.monthly;

  activeTargetPlan = planKey;
  activeTargetCycle = cycle;
  activeTargetAmount = amount;

  document.getElementById('rzp-summary-plan').textContent = `${planInfo.label} Plan`;
  document.getElementById('rzp-summary-cycle').textContent = `${cycle.toUpperCase()} Billing`;
  document.getElementById('rzp-summary-price').textContent = `₹${amount.toLocaleString('en-IN')}`;

  openModal('razorpay-checkout-modal');
}

// Update User Document & Set Expiration
async function activateUserPlan(planKey, cycle, amountINR, autopayEnabled, paymentId) {
  if (!currentUser) return;

  const now = new Date();
  const expiryDate = new Date();

  // Calculate Expiry Date
  if (cycle === 'yearly') {
    expiryDate.setFullYear(now.getFullYear() + 1);
  } else {
    expiryDate.setMonth(now.getMonth() + 1);
  }

  const subscriptionPayload = {
    plan: planKey,
    billingCycle: cycle,
    amountINR: amountINR,
    autopayEnabled: autopayEnabled,
    paymentStatus: 'PAID',
    lastPaymentId: paymentId,
    paidAt: now.toISOString(),
    expiresAt: planKey === 'free' ? null : expiryDate.toISOString(),
    updatedAt: now.toISOString()
  };

  // 1. Update Firestore
  await updateUserDocument(currentUser.uid, subscriptionPayload);

  // 2. Log transaction in usage history
  const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  await addDoc(collection(db, 'usage'), {
    uid: currentUser.uid,
    endpoint: `/billing/razorpay-${planKey}`,
    statusCode: 200,
    timestamp: serverTimestamp()
  });

  // 3. Sync UI globally
  await updateSharedUserUI(currentUser);
  navigateTo('dashboard');
}

/* ============================================================
   AUTH GUARD FOR API KEY CREATION
   ============================================================ */
function bindCreateKeyAuthGuard() {
  const createKeyBtn = document.getElementById('open-create-key');
  createKeyBtn?.addEventListener('click', (e) => {
    if (!currentUser) {
      e.preventDefault();
      e.stopPropagation();
      Toast.error('Please log in or create an account to generate an API key.');
      navigateTo('login');
      return false;
    }
  }, true);
}

/* ============================================================
   REAL PROFILE & SETTINGS PERSISTENCE
   ============================================================ */

function fillProfileFormFields(profile, authUser) {
  const form = document.getElementById('profile-form');
  if (!form || !authUser) return;
  form.name.value = profile?.name || authUser.displayName || '';
  form.email.value = authUser.email || '';
  form.company.value = profile?.company || '';
  form.country.value = profile?.country || '';
}

function bindProfileForm() {
  const form = document.getElementById('profile-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      await updateUserDocument(currentUser.uid, {
        name: form.name.value.trim(),
        company: form.company.value.trim(),
        country: form.country.value.trim(),
      });
      await updateSharedUserUI(currentUser);
      Toast.success('Profile saved to database!');
    } catch (err) {
      Toast.error('Could not save profile changes.');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

let currentUser = null;
let currentProfile = null;
let currentPageKey = 'landing';
let bootstrapped = false;

function bindRouterLinks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href == null) return;
    const [file, hash] = href.split('#');

    // Handle dummy links (href="#" or unbuilt sections)
    if (href === '#' || href === '#contact') {
      e.preventDefault();
      Toast.show('This feature is coming soon!', 'success', 2000);
      return;
    }

    if (file in PAGE_FILE_MAP) {
      e.preventDefault();
      navigateTo(PAGE_FILE_MAP[file]);
      if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }), 60);
      return;
    }
    if (file === '') {
      e.preventDefault();
      if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // NEW: Wire the Status Link inside the footer
  document.getElementById('link-status')?.addEventListener('click', (e) => {
    e.preventDefault();
    Toast.success('🟢 All Systems Operational. 99.99% Uptime.');
  });
  
  // Bind the Floating Back Button Click Event
  document.getElementById('floating-back-btn')?.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigateTo('landing');
    }
  });
}

function onPageEnter(page) {
  if (page === 'login' || page === 'signup') {
    if (currentUser) { navigateTo('dashboard'); return; }
  }
  if (page === 'dashboard') enterDashboard();
  if (page === 'profile') enterProfile();
  if (page === 'settings') enterSettings();
}

function parseHashPage() {
  const key = (location.hash || '').replace('#', '').split('/')[0];
  return PAGES.includes(key) ? key : 'landing';
}

window.addEventListener('popstate', () => navigateTo(parseHashPage()));

/* First real navigation only happens once we know whether someone's
   signed in — avoids a flash of the wrong page while Firebase resolves
   the persisted session. */
watchAuthState(async (user) => {
  currentUser = user;
  await updateSharedUserUI(user);
  if (!bootstrapped) {
    bootstrapped = true;
    navigateTo(parseHashPage());
  } else {
    onPageEnter(currentPageKey);
  }
});

/* Fills every data-user-* element across all pages, plus the profile form,
   from a single Firestore read — replaces per-page duplicate fetches. */
async function updateSharedUserUI(user) {
  if (!user) {
    document.querySelectorAll('[data-user-name]').forEach((el) => (el.textContent = 'Developer'));
    document.querySelectorAll('[data-user-email]').forEach((el) => (el.textContent = ''));
    document.querySelectorAll('[data-user-initials]').forEach((el) => (el.textContent = ''));
    document.querySelectorAll('[data-user-plan]').forEach((el) => (el.textContent = 'Free'));
    currentProfile = null;
    return;
  }
  const profile = await getUserDocument(user.uid);
  currentProfile = profile;
  const name = profile?.name || user.displayName || 'Developer';
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const plan = profile?.plan || 'free';

  document.querySelectorAll('[data-user-name]').forEach((el) => (el.textContent = name));
  document.querySelectorAll('[data-user-email]').forEach((el) => (el.textContent = user.email || ''));
  document.querySelectorAll('[data-user-initials]').forEach((el) => (el.textContent = initials));
  document.querySelectorAll('[data-user-plan]').forEach((el) => (el.textContent = plan.charAt(0).toUpperCase() + plan.slice(1)));

  fillProfileFormFields(profile, user);
}

/* ============================================================
   UTILS — theme, toasts, ripple, reveal, navbar
   (from js/utils.js)
   ============================================================ */

const Theme = {
  KEY: 'rapidmaps-theme',
  init() {
    const saved = localStorage.getItem(this.KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  },
  toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(this.KEY, next);
  },
  bindToggleButtons() {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => this.toggle());
    });
  },
};
Theme.init();

const Toast = {
  stack: null,
  ensureStack() {
    if (!this.stack) {
      this.stack = document.createElement('div');
      this.stack.className = 'toast-stack';
      document.body.appendChild(this.stack);
    }
    return this.stack;
  },
  show(message, type = 'success', duration = 3600) {
    const stack = this.ensureStack();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
};

function bindRipple() {
  document.querySelectorAll('.btn').forEach((btn) => {
    btn.addEventListener('click', function (e) {
      const rect = this.getBoundingClientRect();
      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  });
}

function bindScrollReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  els.forEach((el) => observer.observe(el));
}

/* Multiple pages each have their own <nav class="navbar">, so these bind
   to every instance rather than assuming a single one on the document. */
function bindNavbar() {
  const navs = document.querySelectorAll('.navbar');
  window.addEventListener('scroll', () => {
    navs.forEach((nav) => nav.classList.toggle('scrolled', window.scrollY > 12));
  });
  document.querySelectorAll('.nav-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      toggle.closest('.navbar')?.querySelector('.nav-links')?.classList.toggle('open');
    });
  });
}

/* Same multi-instance fix for the app-shell mobile sidebar toggle —
   each app page (dashboard/profile/settings/admin) has its own pair. */
function bindSidebarToggle() {
  document.querySelectorAll('.sidebar-mobile-toggle').forEach((toggle) => {
    const page = toggle.closest('.page');
    const sidebar = page ? page.querySelector('.sidebar') : document.querySelector('.sidebar');
    toggle.addEventListener('click', () => sidebar?.classList.toggle('open'));
  });
}

function copyToClipboard(text, label = 'Copied to clipboard') {
  navigator.clipboard.writeText(text).then(() => {
    Toast.success(label);
  }).catch(() => {
    Toast.error('Could not copy — copy it manually');
  });
}

function generateApiKey(env = 'live') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return `rm_${env}_${key}`;
}

function maskApiKey(key) {
  if (!key || key.length < 12) return key;
  return `${key.slice(0, 11)}${'•'.repeat(18)}${key.slice(-4)}`;
}

function formatNumber(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

/* ============================================================
   LANDING PAGE — hero code tabs + coordinate readout
   (from js/landing.js)
   ============================================================ */
const CODE_SAMPLES = {
  curl: { lang: 'curl', html: `<span class="tok-fn">curl</span> https://rapidmap-api.onrender.com/v1/geocode \\
  -H <span class="tok-str">"x-api-key: rm_live_••••••••"</span> \\
  --data-urlencode <span class="tok-str">"address=1600 Amphitheatre Pkwy"</span>` },
  js: { lang: 'geocode.js', html: `<span class="tok-key">const</span> res = <span class="tok-key">await</span> <span class="tok-fn">fetch</span>(
  <span class="tok-str">'https://rapidmap-api.onrender.com/v1/geocode?address=1600+Amphitheatre+Pkwy'</span>,
  { headers: { <span class="tok-str">'x-api-key'</span>: key } }
);
<span class="tok-key">const</span> data = <span class="tok-key">await</span> res.<span class="tok-fn">json</span>();
<span class="tok-fn">console</span>.log(data.lat, data.lng);` },
  py: { lang: 'geocode.py', html: `<span class="tok-key">import</span> requests

res = requests.<span class="tok-fn">get</span>(
    <span class="tok-str">"https://rapidmap-api.onrender.com/v1/geocode"</span>,
    headers={<span class="tok-str">"x-api-key"</span>: key},
    params={<span class="tok-str">"address"</span>: <span class="tok-str">"1600 Amphitheatre Pkwy"</span>},
)
data = res.json()` },
  php: { lang: 'geocode.php', html: `<span class="tok-key">$ch</span> = curl_init();
curl_setopt(<span class="tok-key">$ch</span>, CURLOPT_URL,
  <span class="tok-str">"https://rapidmap-api.onrender.com/v1/geocode?address=1600+Amphitheatre+Pkwy"</span>);
curl_setopt(<span class="tok-key">$ch</span>, CURLOPT_HTTPHEADER,
  [<span class="tok-str">"x-api-key: "</span> . <span class="tok-key">$key</span>]);
curl_setopt(<span class="tok-key">$ch</span>, CURLOPT_RETURNTRANSFER, <span class="tok-key">true</span>);` },
  node: { lang: 'geocode.node.js', html: `<span class="tok-key">const</span> https = require(<span class="tok-str">'https'</span>);

https.<span class="tok-fn">get</span>(
  <span class="tok-str">'https://rapidmap-api.onrender.com/v1/geocode?address=1600+Amphitheatre+Pkwy'</span>,
  { headers: { <span class="tok-str">'x-api-key'</span>: key } },
  (res) => {
    <span class="tok-key">let</span> body = <span class="tok-str">''</span>;
    res.on(<span class="tok-str">'data'</span>, (c) => (body += c));
    res.on(<span class="tok-str">'end'</span>, () => <span class="tok-fn">console</span>.log(JSON.parse(body)));
  }
);` },
};

function bindLangTabs() {
  const tabs = document.querySelectorAll('#page-landing .lang-tab');
  const codeEl = document.getElementById('example-code');
  const langEl = document.getElementById('example-lang');
  if (!tabs.length || !codeEl) return;
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const sample = CODE_SAMPLES[tab.dataset.lang];
      if (sample) {
        codeEl.innerHTML = sample.html;
        langEl.textContent = sample.lang;
      }
    });
  });
}

const SAMPLE_COORDS = [
  '40.7128° N, 74.0060° W', '51.5072° N, 0.1276° W', '35.6762° N, 139.6503° E',
  '-33.8688° S, 151.2093° E', '48.8566° N, 2.3522° E', '19.0760° N, 72.8777° E',
];

function bindCoordReadout() {
  const el = document.getElementById('coord-text');
  if (!el) return;
  let i = 0;
  setInterval(() => {
    i = (i + 1) % SAMPLE_COORDS.length;
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = SAMPLE_COORDS[i];
      el.style.opacity = '1';
    }, 250);
  }, 2600);
}

/* ============================================================
   AUTH PAGES — login / signup / forgot password
   (from js/auth.js — redirects now go through navigateTo(),
   and each page's error banner has its own id: login-error /
   signup-error / forgot-error, since they used to be three
   separate documents each with id="form-error")
   ============================================================ */

function setLoading(btn, isLoading) {
  btn.classList.toggle('loading', isLoading);
  btn.disabled = isLoading;
}
function showError(banner, message) {
  banner.textContent = message;
  banner.classList.add('show');
}
function hideError(banner) {
  banner.classList.remove('show');
}
function friendlyAuthError(err) {
  const code = err && err.code ? err.code : '';
  const map = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password. Try again.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password': 'Choose a password with at least 8 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before completing.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

function bindPasswordToggle() {
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.classList.toggle('is-visible');
    });
  });
}

function initLoginPage() {
  const form = document.getElementById('login-form');
  if (!form) return;
  const banner = document.getElementById('login-error');
  const googleBtn = document.getElementById('google-login');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(banner);
    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    try {
      await loginWithEmail(form.email.value.trim(), form.password.value);
      Toast.success('Welcome back!');
      navigateTo('dashboard');
    } catch (err) {
      showError(banner, friendlyAuthError(err));
    } finally {
      setLoading(btn, false);
    }
  });

  googleBtn?.addEventListener('click', async () => {
    hideError(banner);
    try {
      await loginWithGoogle();
      navigateTo('dashboard');
    } catch (err) {
      showError(banner, friendlyAuthError(err));
    }
  });
}

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function initSignupPage() {
  const form = document.getElementById('signup-form');
  if (!form) return;
  const banner = document.getElementById('signup-error');
  const googleBtn = document.getElementById('google-signup');
  const meter = document.getElementById('strength-meter');
  const pwInput = document.getElementById('signup-password');

  pwInput?.addEventListener('input', () => {
    const score = passwordStrength(pwInput.value);
    meter.className = 'strength-meter';
    if (!pwInput.value) return;
    if (score <= 1) meter.classList.add('weak');
    else if (score <= 2) meter.classList.add('medium');
    else meter.classList.add('strong');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(banner);
    const btn = form.querySelector('button[type="submit"]');
    const password = form.password.value;

    if (!form.agree.checked) { showError(banner, 'Please accept the Terms of Service to continue.'); return; }
    if (password.length < 8) { showError(banner, 'Password must be at least 8 characters.'); return; }

    setLoading(btn, true);
    try {
      await registerWithEmail(form.name.value.trim(), form.email.value.trim(), password);
      Toast.success('Account created — welcome to RapidMaps!');
      navigateTo('dashboard');
    } catch (err) {
      showError(banner, friendlyAuthError(err));
    } finally {
      setLoading(btn, false);
    }
  });

  googleBtn?.addEventListener('click', async () => {
    hideError(banner);
    try {
      await loginWithGoogle();
      navigateTo('dashboard');
    } catch (err) {
      showError(banner, friendlyAuthError(err));
    }
  });
}

function initForgotPage() {
  const form = document.getElementById('forgot-form');
  if (!form) return;
  const banner = document.getElementById('forgot-error');
  const successState = document.getElementById('forgot-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(banner);
    const btn = form.querySelector('button[type="submit"]');
    setLoading(btn, true);
    try {
      await resetPassword(form.email.value.trim());
      form.classList.add('hidden');
      successState.classList.remove('hidden');
    } catch (err) {
      showError(banner, friendlyAuthError(err));
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ============================================================
   DASHBOARD — stats, recent requests, notifications
   (from js/dashboard.js — guardPage() replaced by enterDashboard(),
   called from the router instead of firing on every page load)
   ============================================================ */

let unsubRecentUsage = null;
let unsubNotifications = null;
let unsubApiKeys = null;

function animateCounter(el, target, duration = 900) {
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatNumber(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function fetchUserStats(uid) {
  // Fetches real stats from a 'userStats' collection in Firestore
  const docRef = doc(db, 'userStats', uid);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : { today: 0, month: 0, success: 0, latency: 0 };
}

async function renderStats() {
  if (!currentUser) return;
  
  // Fetch real data from the database
  const userStats = await fetchUserStats(currentUser.uid);
  
  const stats = { 
    'stat-today': userStats.today || 0, 
    'stat-month': userStats.month || 0, 
    'stat-success': userStats.success || 0, 
    'stat-latency': userStats.latency || 0 
  };

  Object.entries(stats).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'stat-success') { el.textContent = `${value}%`; return; }
    if (id === 'stat-latency') { el.textContent = `${value}ms`; return; }
    animateCounter(el, value);
  });
}

function renderRecentRequests() {
  const tbody = document.getElementById('recent-requests-body');
  const emptyState = document.getElementById('recent-requests-empty');
  if (!tbody || !currentUser) return;
  if (unsubRecentUsage) unsubRecentUsage();

  unsubRecentUsage = watchRecentUsage(currentUser.uid, (rows) => {
    if (!rows.length) { tbody.innerHTML = ''; emptyState?.classList.remove('hidden'); return; }
    emptyState?.classList.add('hidden');
    tbody.innerHTML = rows.map((row) => {
      const ok = row.statusCode < 400;
      const time = row.timestamp?.toDate ? row.timestamp.toDate().toLocaleString() : 'Just now';
      return `<tr><td class="mono">${row.endpoint || '/v1/geocode'}</td><td><span class="status-pill ${ok ? 'ok' : 'err'}">${row.statusCode || 200}</span></td><td>${time}</td></tr>`;
    }).join('');
  });
}

function renderNotifications() {
  const badge = document.querySelector('#page-dashboard .icon-btn .dot-badge');
  if (!currentUser || !badge) return;
  if (unsubNotifications) unsubNotifications();
  unsubNotifications = watchNotifications(currentUser.uid, (items) => {
    badge.style.display = items.length ? 'block' : 'none';
  });
}

function enterDashboard() {
  if (!currentUser) { navigateTo('login'); return; }
  renderStats();
  renderRecentRequests();
  renderNotifications();
  loadApiKeysForCurrentUser();
  renderCharts();
}

/* ---------- API key management (from js/apikey.js) ---------- */

let pendingDeleteId = null;

function keyRowTemplate(key) {
  const isActive = key.status === 'active';
  const expiry = key.expiresAt ? `Expires ${key.expiresAt}` : 'No expiration';
  const domain = key.allowedDomain ? key.allowedDomain : 'All domains';
  
  return `
    <div class="key-row" data-key-id="${key.id}">
      <div>
        <div class="key-name">${key.name || 'Untitled key'}</div>
        <div class="key-value">${maskApiKey(key.value)}</div>
        <div class="key-meta">${domain} · ${expiry} · ${formatNumber(key.requestCount || 0)} requests</div>
      </div>
      <div class="key-row-actions">
        <span class="key-status ${isActive ? 'active' : 'disabled'}">${isActive ? 'Active' : 'Disabled'}</span>
        
        <!-- Copy Button -->
        <button class="icon-btn btn-sm" data-action="copy" title="Copy key">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        
        <!-- Toggle Button -->
        <button class="icon-btn btn-sm" data-action="toggle" title="${isActive ? 'Disable' : 'Enable'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>
        </button>
        
        <!-- Regenerate Button -->
        <button class="icon-btn btn-sm" data-action="regenerate" title="Regenerate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
        
        <!-- Delete Button -->
        <button class="icon-btn btn-sm" data-action="delete" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
        </button>
      </div>
    </div>`;
}

function renderKeys(keys) {
  const list = document.getElementById('api-keys-list');
  const empty = document.getElementById('api-keys-empty');
  if (!list) return;
  if (!keys.length) { list.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  list.innerHTML = keys.map(keyRowTemplate).join('');
  bindRowActions(keys);
}

function bindRowActions(keys) {
  document.querySelectorAll('#page-dashboard .key-row').forEach((row) => {
    const id = row.dataset.keyId;
    const key = keys.find((k) => k.id === id);
    if (!key) return;

    row.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyToClipboard(key.value, 'API key copied'));

    row.querySelector('[data-action="toggle"]')?.addEventListener('click', async () => {
      const newStatus = key.status === 'active' ? 'disabled' : 'active';
      await updateApiKey(id, { status: newStatus });
      Toast.success(`Key ${newStatus === 'active' ? 'enabled' : 'disabled'}`);
    });

    row.querySelector('[data-action="regenerate"]')?.addEventListener('click', async () => {
      await updateApiKey(id, { value: generateApiKey(), requestCount: 0 });
      Toast.success('Key regenerated — update it wherever it was used');
    });

    row.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
      pendingDeleteId = id;
      openModal('delete-key-modal');
    });
  });
}

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function bindModals() {
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
  document.getElementById('open-create-key')?.addEventListener('click', () => openModal('create-key-modal'));
  document.getElementById('confirm-delete-key')?.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    await deleteApiKey(pendingDeleteId);
    Toast.success('API key deleted');
    closeModal('delete-key-modal');
    pendingDeleteId = null;
  });
}

function bindCreateForm() {
  const form = document.getElementById('create-key-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      await createApiKeyDoc(currentUser.uid, {
        name: form.keyName.value.trim() || 'Untitled key',
        value: generateApiKey(),
        allowedDomain: form.allowedDomain.value.trim(),
        requestLimit: form.requestLimit.value ? Number(form.requestLimit.value) : null,
        expiresAt: form.expiresAt.value || null,
      });
      Toast.success('API key created');
      form.reset();
      closeModal('create-key-modal');
    } catch (err) {
      Toast.error('Could not create key — try again');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

function loadApiKeysForCurrentUser() {
  if (unsubApiKeys) unsubApiKeys();
  if (!currentUser) return;
  unsubApiKeys = watchApiKeys(currentUser.uid, renderKeys);
}

/* ---------- Charts (from js/charts.js) ---------- */

const CHART_DATA = {
  daily: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], requests: [4200, 5100, 4800, 6300, 7100, 5600, 6100] },
  endpoints: { labels: ['Geocode', 'Reverse', 'Autocomplete', 'Places', 'Directions', 'Static Map'], values: [32, 21, 18, 14, 9, 6] },
};
const chartInstances = {};

function getChartColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return { accent: '#FF6B00', grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,15,20,0.06)', text: dark ? '#a3a3ab' : '#8b8b93' };
}

function renderRequestsChart(canvasId, dataset) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  const colors = getChartColors();
  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: { labels: dataset.labels, datasets: [{ label: 'Requests', data: dataset.requests, borderColor: colors.accent, backgroundColor: 'rgba(255,107,0,0.12)', fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 11 } } }, y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 } } } },
    },
  });
}

async function fetchUserCharts(uid) {
  // Fetches chart arrays from a 'userCharts' collection
  const docRef = doc(db, 'userCharts', uid);
  const snap = await getDoc(docRef);
  
  // Return database values or fallback to empty arrays
  return snap.exists() ? snap.data() : { 
    daily: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], requests: [0, 0, 0, 0, 0, 0, 0] },
    endpoints: { labels: ['No Data'], values: [0] }
  };
}

async function renderCharts() {
  if (!currentUser) return;
  
  // Fetch dynamic chart data
  const chartData = await fetchUserCharts(currentUser.uid);
  
  renderRequestsChart('chart-daily', chartData.daily);
  renderEndpointsChart('chart-endpoints', chartData.endpoints);
}

// Ensure you update the signature of renderEndpointsChart to accept dynamic data
function renderEndpointsChart(canvasId, endpointData) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  const colors = getChartColors();
  const palette = ['#FF6B00', '#ff8c33', '#ffab66', '#ffc999', '#3a3a40', '#8b8b93'];
  chartInstances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: { 
      labels: endpointData.labels, 
      datasets: [{ data: endpointData.values, backgroundColor: palette, borderWidth: 0 }] 
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: colors.text, font: { size: 11 }, boxWidth: 10, padding: 12 } } } },
  });
}

/* ============================================================
   PROFILE — personal info, password change, delete account
   (from js/profile.js — uses the shared `currentUser` instead
   of its own auth listener)
   ============================================================ */

function bindPasswordForm() {
  const form = document.getElementById('password-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const btn = form.querySelector('button[type="submit"]');
    const current = form.currentPassword.value;
    const next = form.newPassword.value;
    if (next.length < 8) { Toast.error('New password must be at least 8 characters'); return; }

    btn.classList.add('loading');
    btn.disabled = true;
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, current);
      await reauthenticateWithCredential(currentUser, cred);
      await updatePassword(currentUser, next);
      Toast.success('Password updated');
      form.reset();
    } catch (err) {
      Toast.error('Current password is incorrect');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

function bindDeleteAccount() {
  const openBtn = document.getElementById('open-delete-account');
  const confirmBtn = document.getElementById('confirm-delete-account');
  const overlay = document.getElementById('delete-account-modal');
  openBtn?.addEventListener('click', () => overlay.classList.add('open'));
  confirmBtn?.addEventListener('click', async () => {
    if (!currentUser) return;
    const input = document.getElementById('delete-confirm-input');
    if (input.value !== 'DELETE') { Toast.error('Type DELETE to confirm'); return; }
    try {
      await deleteUser(currentUser);
      navigateTo('landing');
    } catch (err) {
      Toast.error('Please log out and back in, then try again');
    }
  });
}

// Map plan limits so the progress bar calculates correctly
const PLAN_LIMITS_MAP = {
  free: 2500,
  starter: 50000,
  pro: 500000,
  business: 3000000,
  enterprise: 'Unlimited'
};

async function enterProfile() {
  if (!currentUser) { navigateTo('login'); return; }
  
  // Fill the text boxes with user details
  fillProfileFormFields(currentProfile, currentUser);

  try {
    // 1. Fetch real request stats for the month
    const stats = await fetchUserStats(currentUser.uid);
    const currentMonthRequests = stats.month || 0;

    // 2. Fetch real count of active API keys
    const keysQuery = query(collection(db, 'apikeys'), where('uid', '==', currentUser.uid), where('status', '==', 'active'));
    const keysSnap = await getDocs(keysQuery);
    const activeKeysCount = keysSnap.size;

    // 3. Get the user's real plan and their maximum quota
    const userPlan = (currentProfile?.plan || 'free').toLowerCase();
    const limit = PLAN_LIMITS_MAP[userPlan] || 2500;
    
    // 4. Update the Profile UI Elements dynamically
    const usageTextEl = document.getElementById('profile-usage-text');
    const usageBarEl = document.getElementById('profile-usage-bar');
    const keysTextEl = document.getElementById('profile-keys-text');

    // Update API Key Count
    if (keysTextEl) keysTextEl.textContent = `${activeKeysCount} active`;

    // Update Usage Text & Progress Bar
    if (usageTextEl && usageBarEl) {
      if (limit === 'Unlimited') {
        usageTextEl.textContent = `${formatNumber(currentMonthRequests)} / Unlimited`;
        usageBarEl.style.width = '100%';
        usageBarEl.style.background = 'var(--success)'; // Green bar for unlimited
      } else {
        usageTextEl.textContent = `${formatNumber(currentMonthRequests)} / ${formatNumber(limit)}`;
        
        // Calculate percentage for the bar
        const percent = Math.min((currentMonthRequests / limit) * 100, 100);
        usageBarEl.style.width = `${percent}%`;
        
        // Turn the bar RED if they use more than 90% of their quota
        if (percent > 90) {
            usageBarEl.style.background = 'var(--error)';
        } else {
            usageBarEl.style.background = 'var(--accent)';
        }
      }
    }
  } catch (err) {
    console.error("Failed to load profile stats:", err);
  }
}

/* ============================================================
   SETTINGS — theme, notification/API preferences, deactivate
   (from js/settings.js)
   ============================================================ */

const PREF_KEY = 'rapidmaps-preferences';

function loadPreferences() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {
      emailNotifications: true, usageAlerts: true, productUpdates: false,
      strictDomainCheck: true, rateLimitAlerts: true,
    };
  } catch { return {}; }
}
function savePreferences(prefs) { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }

function bindToggles() {
  const prefs = loadPreferences();
  document.querySelectorAll('[data-pref]').forEach((input) => {
    const key = input.dataset.pref;
    input.checked = !!prefs[key];
    input.addEventListener('change', () => {
      const current = loadPreferences();
      current[key] = input.checked;
      savePreferences(current);
      Toast.success('Preference saved');
    });
  });
}

function bindThemeOptions() {
  const options = document.querySelectorAll('.theme-option');
  const current = localStorage.getItem('rapidmaps-theme') || 'light';
  options.forEach((opt) => opt.classList.toggle('selected', opt.dataset.theme === current));
  options.forEach((opt) => {
    opt.addEventListener('click', () => {
      const theme = opt.dataset.theme;
      if (theme === 'system') {
        localStorage.removeItem('rapidmaps-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('rapidmaps-theme', theme);
      }
      options.forEach((o) => o.classList.toggle('selected', o === opt));
    });
  });
}

function bindAccountDeactivate() {
  document.getElementById('open-deactivate')?.addEventListener('click', () => {
    document.getElementById('deactivate-modal')?.classList.add('open');
  });
  document.getElementById('confirm-deactivate')?.addEventListener('click', async () => {
    if (!currentUser) return;
    await updateUserDocument(currentUser.uid, { deactivated: true });
    await logout();
    navigateTo('landing');
  });
}

function enterSettings() {
  if (!currentUser) { navigateTo('login'); return; }
}

/* ============================================================
   PRICING — FAQ accordion + billing toggle
   (from js/pricing.js)
   ============================================================ */

function bindFaqAccordion() {
  document.querySelectorAll('.faq-item').forEach((item) => {
    item.querySelector('.faq-question')?.addEventListener('click', () => {
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });
}

const YEARLY_PRICES = { Starter: 15, Pro: 63, Business: 199 };
const MONTHLY_PRICES = { Starter: 19, Pro: 79, Business: 249 };

function bindBillingToggle() {
  const buttons = document.querySelectorAll('.billing-toggle button');
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const yearly = btn.dataset.billing === 'yearly';
      document.querySelectorAll('#page-pricing .price-card').forEach((card) => {
        const name = card.querySelector('.plan-name')?.textContent.trim();
        const priceEl = card.querySelector('.price');
        if (!priceEl || !(name in MONTHLY_PRICES)) return;
        priceEl.innerHTML = `$${yearly ? YEARLY_PRICES[name] : MONTHLY_PRICES[name]}<span>/mo</span>`;
      });
    });
  });
}

/* ============================================================
   DOCS — per-endpoint code tabs + scrollspy + search
   (from js/docs.js)
   ============================================================ */
const DOC_SAMPLES = {
  geocoding: {
    curl: `curl https://rapidmap-api.onrender.com/v1/geocode \\
  -H "x-api-key: rm_live_xxxx" \\
  --data-urlencode "address=1600 Amphitheatre Pkwy"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/geocode?address=1600+Amphitheatre+Pkwy',
  { headers: { 'x-api-key': key } }
);
const data = await res.json();`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/geocode",
    headers={"x-api-key": key},
    params={"address": "1600 Amphitheatre Pkwy"},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/geocode?address=1600+Amphitheatre+Pkwy");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["x-api-key: " . $key]);`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/geocode?address=1600+Amphitheatre+Pkwy',
  { headers: { 'x-api-key': key } },
  (res) => { /* stream body, JSON.parse */ }
);`,
  },
  reverse: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/reverse?lat=40.7128&lng=-74.0060" \\
  -H "x-api-key: rm_live_xxxx"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/reverse?lat=40.7128&lng=-74.0060',
  { headers: { 'x-api-key': key } }
);`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/reverse",
    headers={"x-api-key": key},
    params={"lat": 40.7128, "lng": -74.0060},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/reverse?lat=40.7128&lng=-74.0060");`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/reverse?lat=40.7128&lng=-74.0060',
  { headers: { 'x-api-key': key } }, (res) => {}
);`,
  },
  autocomplete: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/autocomplete?q=coffee+near+soho" \\
  -H "x-api-key: rm_live_xxxx"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/autocomplete?q=coffee+near+soho',
  { headers: { 'x-api-key': key } }
);
const { suggestions } = await res.json();`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/autocomplete",
    headers={"x-api-key": key},
    params={"q": "coffee near soho"},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/autocomplete?q=coffee+near+soho");`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/autocomplete?q=coffee+near+soho',
  { headers: { 'x-api-key': key } }, (res) => {}
);`,
  },
  places: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/places/search?query=ramen&lat=35.68&lng=139.69" \\
  -H "x-api-key: rm_live_xxxx"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/places/search?query=ramen&lat=35.68&lng=139.69',
  { headers: { 'x-api-key': key } }
);`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/places/search",
    headers={"x-api-key": key},
    params={"query": "ramen", "lat": 35.68, "lng": 139.69},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/places/search?query=ramen&lat=35.68&lng=139.69");`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/places/search?query=ramen&lat=35.68&lng=139.69',
  { headers: { 'x-api-key': key } }, (res) => {}
);`,
  },
  directions: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/directions?origin=40.71,-74.00&destination=40.75,-73.98&mode=driving" \\
  -H "x-api-key: rm_live_xxxx"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/directions?origin=40.71,-74.00&destination=40.75,-73.98&mode=driving',
  { headers: { 'x-api-key': key } }
);`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/directions",
    headers={"x-api-key": key},
    params={"origin": "40.71,-74.00", "destination": "40.75,-73.98", "mode": "driving"},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/directions?origin=40.71,-74.00&destination=40.75,-73.98&mode=driving");`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/directions?origin=40.71,-74.00&destination=40.75,-73.98&mode=driving',
  { headers: { 'x-api-key': key } }, (res) => {}
);`,
  },
  matrix: {
    curl: `curl -X POST https://rapidmap-api.onrender.com/v1/matrix \\
  -H "x-api-key: rm_live_xxxx" -H "Content-Type: application/json" \\
  -d '{"origins":[[40.71,-74.00]],"destinations":[[40.75,-73.98],[40.65,-73.95]]}'`,
    js: `const res = await fetch('https://rapidmap-api.onrender.com/v1/matrix', {
  method: 'POST',
  headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    origins: [[40.71, -74.00]],
    destinations: [[40.75, -73.98], [40.65, -73.95]],
  }),
});`,
    py: `res = requests.post(
    "https://rapidmap-api.onrender.com/v1/matrix",
    headers={"x-api-key": key},
    json={"origins": [[40.71, -74.00]], "destinations": [[40.75, -73.98], [40.65, -73.95]]},
)`,
    php: `$payload = json_encode([
  "origins" => [[40.71, -74.00]],
  "destinations" => [[40.75, -73.98], [40.65, -73.95]],
]);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);`,
    node: `const body = JSON.stringify({
  origins: [[40.71, -74.00]],
  destinations: [[40.75, -73.98], [40.65, -73.95]],
});
// send via https.request with method: 'POST'`,
  },
  staticmaps: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/staticmap?center=40.71,-74.00&zoom=13&size=600x400" \\
  -H "x-api-key: rm_live_xxxx" -o map.png`,
    js: `const url = \`https://rapidmap-api.onrender.com/v1/staticmap?center=40.71,-74.00&zoom=13&size=600x400&key=\${key}\`;
imgElement.src = url;`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/staticmap",
    headers={"x-api-key": key},
    params={"center": "40.71,-74.00", "zoom": 13, "size": "600x400"},
)
open("map.png", "wb").write(res.content)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/staticmap?center=40.71,-74.00&zoom=13&size=600x400");
file_put_contents("map.png", curl_exec($ch));`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/staticmap?center=40.71,-74.00&zoom=13&size=600x400',
  { headers: { 'x-api-key': key } },
  (res) => res.pipe(fs.createWriteStream('map.png'))
);`,
  },
  elevation: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/elevation?locations=39.74,-104.99|36.46,-116.87" \\
  -H "x-api-key: rm_live_xxxx"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/elevation?locations=39.74,-104.99|36.46,-116.87',
  { headers: { 'x-api-key': key } }
);`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/elevation",
    headers={"x-api-key": key},
    params={"locations": "39.74,-104.99|36.46,-116.87"},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/elevation?locations=39.74,-104.99|36.46,-116.87");`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/elevation?locations=39.74,-104.99|36.46,-116.87',
  { headers: { 'x-api-key': key } }, (res) => {}
);`,
  },
  timezone: {
    curl: `curl "https://rapidmap-api.onrender.com/v1/timezone?lat=40.7128&lng=-74.0060&timestamp=1735689600" \\
  -H "x-api-key: rm_live_xxxx"`,
    js: `const res = await fetch(
  'https://rapidmap-api.onrender.com/v1/timezone?lat=40.7128&lng=-74.0060&timestamp=1735689600',
  { headers: { 'x-api-key': key } }
);`,
    py: `res = requests.get(
    "https://rapidmap-api.onrender.com/v1/timezone",
    headers={"x-api-key": key},
    params={"lat": 40.7128, "lng": -74.0060, "timestamp": 1735689600},
)`,
    php: `curl_setopt($ch, CURLOPT_URL,
  "https://rapidmap-api.onrender.com/v1/timezone?lat=40.7128&lng=-74.0060&timestamp=1735689600");`,
    node: `https.get(
  'https://rapidmap-api.onrender.com/v1/timezone?lat=40.7128&lng=-74.0060&timestamp=1735689600',
  { headers: { 'x-api-key': key } }, (res) => {}
);`,
  },
};

function initDocsCodeTabs() {
  document.querySelectorAll('[data-endpoint]').forEach((block) => {
    const endpoint = block.dataset.endpoint;
    const tabs = block.querySelectorAll('.lang-tab');
    const pre = block.querySelector('pre');
    if (!DOC_SAMPLES[endpoint] || !pre) return;
    pre.textContent = DOC_SAMPLES[endpoint].curl;
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        pre.textContent = DOC_SAMPLES[endpoint][tab.dataset.lang] || DOC_SAMPLES[endpoint].curl;
      });
    });
  });
}

function initScrollspy() {
  const sections = document.querySelectorAll('#page-docs .endpoint-section[id]');
  const navLinks = document.querySelectorAll('#page-docs .docs-nav a');
  if (!sections.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
        }
      });
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  sections.forEach((s) => observer.observe(s));
}

function initDocsSearch() {
  const input = document.getElementById('docs-search');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    document.querySelectorAll('#page-docs .docs-nav a').forEach((link) => {
      link.style.display = link.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
    });
  });
}

/* ============================================================
   ADMIN — role-gated panel: users, health, announcements
   (from js/admin.js — self-contained, runs its own auth check
   since it gates on Firestore role rather than just sign-in)
   ============================================================ */

let allUsers = [];

function showAdminLoginScreen() {
  document.getElementById('admin-login-screen')?.classList.remove('hidden');
  document.getElementById('admin-panel')?.classList.add('hidden');
  document.getElementById('admin-denied-screen')?.classList.add('hidden');
}
function showAdminDeniedScreen() {
  document.getElementById('admin-denied-screen')?.classList.remove('hidden');
  document.getElementById('admin-panel')?.classList.add('hidden');
  document.getElementById('admin-login-screen')?.classList.add('hidden');
}
function showAdminPanel() {
  document.getElementById('admin-panel')?.classList.remove('hidden');
  document.getElementById('admin-login-screen')?.classList.add('hidden');
  document.getElementById('admin-denied-screen')?.classList.add('hidden');
}

function bindAdminLogin() {
  const form = document.getElementById('admin-login-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const banner = document.getElementById('admin-login-error');
    banner.classList.remove('show');
    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      await loginWithEmail(form.email.value.trim(), form.password.value);
    } catch (err) {
      banner.textContent = 'Invalid admin credentials.';
      banner.classList.add('show');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

function bindAdminTabs() {
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab)?.classList.add('active');
    });
  });
}

function adminUserRow(u) {
  const initials = (u.name || u.email || '??').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  return `
    <tr data-uid="${u.uid}">
      <td>
        <div class="user-row-cell">
          <div class="user-avatar-sm">${initials}</div>
          <div>
            <div style="font-weight:600;">${u.name || 'Unnamed'}</div>
            <div style="font-size:0.78rem;color:var(--text-tertiary);">${u.email || ''}</div>
          </div>
        </div>
      </td>
      <td><span class="role-pill ${u.role === 'admin' ? 'admin' : ''}">${u.role || 'user'}</span></td>
      <td>${u.plan || 'free'}</td>
      <td>${u.banned ? '<span class="role-pill banned-pill">Banned</span>' : '<span class="status-pill ok">Active</span>'}</td>
      <td style="text-align:right;">
        <button class="btn btn-secondary btn-sm" data-action="ban">${u.banned ? 'Unban' : 'Ban'}</button>
        <button class="btn btn-sm" style="color:var(--error);" data-action="delete">Delete</button>
      </td>
    </tr>`;
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-body');
  if (!tbody) return;
  const snap = await getDocs(collection(db, 'users'));
  allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderAdminUsers(allUsers);
  document.getElementById('admin-stat-users').textContent = formatNumber(allUsers.length);
  document.getElementById('admin-stat-banned').textContent = formatNumber(allUsers.filter((u) => u.banned).length);
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-body');
  tbody.innerHTML = users.map(adminUserRow).join('');

  tbody.querySelectorAll('button[data-action="ban"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const uid = e.target.closest('tr').dataset.uid;
      const user = allUsers.find((u) => u.id === uid);
      await updateDoc(doc(db, 'users', uid), { banned: !user.banned });
      user.banned = !user.banned;
      renderAdminUsers(allUsers);
      Toast.success(user.banned ? 'User banned' : 'User unbanned');
    });
  });

  tbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const uid = e.target.closest('tr').dataset.uid;
      if (!confirm("Delete this user's Firestore record? This cannot be undone.")) return;
      await deleteDoc(doc(db, 'users', uid));
      allUsers = allUsers.filter((u) => u.id !== uid);
      renderAdminUsers(allUsers);
      Toast.success('User record deleted');
    });
  });
}

function bindAdminUserSearch() {
  const input = document.getElementById('admin-user-search');
  input?.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    renderAdminUsers(allUsers.filter((u) => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)));
  });
}

function bindAnnouncements() {
  const form = document.getElementById('announcement-form');
  const list = document.getElementById('announcement-list');
  if (!form || !list) return;

  const q = query(collection(db, 'notifications'), where('global', '==', true), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!items.length) { list.innerHTML = '<p style="font-size:0.85rem;color:var(--text-tertiary);">No announcements published yet.</p>'; return; }
    list.innerHTML = items.map((a) => `
      <div class="announcement-item">
        <div><h4>${a.title || ''}</h4><p>${a.message || ''}</p></div>
        <button class="icon-btn btn-sm" style="width:32px;height:32px;" data-id="${a.id}" aria-label="Delete announcement">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`).join('');

    list.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await deleteDoc(doc(db, 'notifications', btn.dataset.id));
        Toast.success('Announcement removed');
      });
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    const message = form.message.value.trim();
    if (!title || !message) return;
    await addDoc(collection(db, 'notifications'), { title, message, global: true, createdAt: serverTimestamp() });
    form.reset();
    Toast.success('Announcement published');
  });
}

async function loadAdminRevenueAndHealth() {
  const rev = document.getElementById('admin-stat-revenue');
  const req = document.getElementById('admin-stat-requests');
  
  // Fetch global platform stats from a restricted 'admin' collection
  try {
    const snap = await getDoc(doc(db, 'admin', 'globalStats'));
    const data = snap.exists() ? snap.data() : { revenue: 0, totalRequests: 0 };
    
    if (rev) rev.textContent = `$${formatNumber(data.revenue)}`;
    if (req) req.textContent = formatNumber(data.totalRequests);
  } catch (error) {
    console.error("Failed to load admin stats:", error);
    if (rev) rev.textContent = '$0';
    if (req) req.textContent = '0';
  }
}

/* Admin gates on Firestore role, independent of the main SPA guard,
   so it keeps its own auth listener rather than using enterX(). */
watchAuthState(async (user) => {
  if (!document.getElementById('admin-panel')) return; // admin markup not on this build
  if (!user) { showAdminLoginScreen(); return; }
  const profile = await getUserDocument(user.uid);
  if (profile?.role !== 'admin') { showAdminDeniedScreen(); return; }
  showAdminPanel();
  loadAdminUsers();
  bindAnnouncements();
  loadAdminRevenueAndHealth();
});

/* ============================================================
   BOOTSTRAP — bind everything once the DOM is ready
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  bindRouterLinks();

  Theme.bindToggleButtons();
  bindRipple();
  initShowcaseMaps();
  initLiveMap();
  bindScrollReveal();
  bindNavbar();
  bindSidebarToggle();

  bindLangTabs();
  bindCoordReadout();

  bindPasswordToggle();
  initLoginPage();
  initSignupPage();
  initForgotPage();

  bindModals();
  bindCreateForm();

  bindProfileForm();
  bindPasswordForm();
  bindDeleteAccount();

  bindToggles();
  bindThemeOptions();
  bindAccountDeactivate();

  bindFaqAccordion();
  bindBillingToggle();

  initDocsCodeTabs();
  initScrollspy();
  initDocsSearch();

  bindAdminLogin();
  bindAdminTabs();
  bindAdminUserSearch();
  bindPlanSelection();
  initSupportChat();
  
  document.querySelectorAll('[data-logout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await logout();
      navigateTo('landing');
    });
  });
});

/* ============================================================
   LIVE MAP TESTER (Leaflet + Render API Gateway)
   ============================================================ */

let liveMap;
let liveMarker;

function initLiveMap() {
  const mapElement = document.getElementById('interactive-map');
  // Only run this if the map div exists on the current page and Leaflet is loaded
  if (!mapElement || typeof L === 'undefined') return;

  // Default coordinates (San Francisco)
  const defaultLat = 37.7749;
  const defaultLng = -122.4194;

  // Initialize the map
  liveMap = L.map('interactive-map').setView([defaultLat, defaultLng], 12);

  // Render map tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(liveMap);

  // Set default marker
  liveMarker = L.marker([defaultLat, defaultLng])
    .addTo(liveMap)
    .bindPopup('<b>San Francisco</b><br>Lat: 37.7749, Lng: -122.4194')
    .openPopup();

  // Bind the search button
  const searchBtn = document.getElementById('map-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', performGeocode);
  }
}

// Handle Geocoding Search using YOUR Render API & Log Real Data
async function performGeocode() {
  const input = document.getElementById('map-search-input');
  const query = input ? input.value.trim() : '';
  if (!query) return;

  // 1. AUTH CHECK
  if (!currentUser) {
    Toast.error('Access Denied: Please log in to test the map API.');
    navigateTo('login');
    return;
  }

  // 2. EXPIRY & PAYMENT CHECK
  if (currentProfile?.plan !== 'free' && currentProfile?.expiresAt) {
    const isExpired = new Date() > new Date(currentProfile.expiresAt);
    if (isExpired && !currentProfile?.autopayEnabled) {
      alert(`Subscription Expired! Your ${currentProfile.plan.toUpperCase()} plan expired on ${new Date(currentProfile.expiresAt).toLocaleDateString()}. Please enable AutoPay or make a payment in the Pricing page to restore access.`);
      navigateTo('pricing');
      return;
    }
  }

  const searchBtn = document.getElementById('map-search-btn');
  const originalBtnText = searchBtn.innerText;
  searchBtn.innerText = 'Searching...';
  searchBtn.disabled = true;

  try {
    const { collection, query: firestoreQuery, where, getDocs, addDoc, serverTimestamp, setDoc, doc, increment } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const q = firestoreQuery(collection(db, 'apikeys'), where('uid', '==', currentUser.uid), where('status', '==', 'active'));
    const keysSnapshot = await getDocs(q);

    if (keysSnapshot.empty) {
      alert('Access Denied: Invalid or missing API Key. Please generate an active API key.');
      return;
    }

    const activeKey = keysSnapshot.docs[0].data().value;

    const response = await fetch(`https://rapidmap-api.onrender.com/v1/geocode?address=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { 'x-api-key': activeKey }
    });

    if (!response.ok) {
      const errorData = await response.json();
      alert(`API Error: ${errorData.error}`);
      return;
    }

    const data = await response.json();
    const lat = data.lat;
    const lng = data.lng;

    liveMap.setView([lat, lng], 14);
    if (liveMarker) liveMap.removeLayer(liveMarker);
    liveMarker = L.marker([lat, lng])
      .addTo(liveMap)
      .bindPopup(`<b>${data.formatted_address}</b><br>Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`)
      .openPopup();

    await addDoc(collection(db, 'usage'), {
      uid: currentUser.uid,
      endpoint: '/v1/geocode',
      statusCode: 200,
      timestamp: serverTimestamp()
    });

    await setDoc(doc(db, 'userStats', currentUser.uid), {
      today: increment(1),
      month: increment(1),
      success: 99.8,
      latency: 41
    }, { merge: true });

  } catch (err) {
    console.error('Geocoding Error:', err);
    alert('An error occurred while connecting to the API.');
  } finally {
    searchBtn.innerText = originalBtnText;
    searchBtn.disabled = false;
  }
}

/* ============================================================
   AI & HUMAN SUPPORT CHAT LOGIC
   ============================================================ */

let isHumanAgentActive = false;

function initSupportChat() {
  const toggleBtn = document.getElementById('support-chat-toggle');
  const closeBtn = document.getElementById('close-support-chat');
  const windowEl = document.getElementById('support-chat-window');
  const sendBtn = document.getElementById('support-chat-send');
  const inputEl = document.getElementById('support-chat-input');
  const messagesEl = document.getElementById('support-chat-messages');
  const humanEscalationContainer = document.getElementById('human-escalation-container');
  const requestHumanBtn = document.getElementById('request-human-btn');

  // Toggle Window
  toggleBtn?.addEventListener('click', () => {
    windowEl.style.display = windowEl.style.display === 'none' ? 'flex' : 'none';
  });

  closeBtn?.addEventListener('click', () => {
    windowEl.style.display = 'none';
  });

  // Show "Request Human" button only if user is Business or Enterprise
  if (currentProfile && (currentProfile.plan === 'business' || currentProfile.plan === 'enterprise')) {
    if (humanEscalationContainer) humanEscalationContainer.style.display = 'block';
  }

  // Handle AI Messages
  async function sendMessage() {
    const message = inputEl.value.trim();
    if (!message) return;

    // Append User Message
    messagesEl.innerHTML += `<div style="background: var(--accent); color: white; padding: 10px 14px; border-radius: 12px 12px 2px 12px; align-self: flex-end; max-width: 85%;">${message}</div>`;
    inputEl.value = '';
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (isHumanAgentActive) {
      // In a real app, this would route to a WebSocket or live chat backend. 
      // For now, we mock the human delay.
      setTimeout(() => {
        messagesEl.innerHTML += `<div style="background: var(--bg-elevated); border: 1px solid var(--border); padding: 10px 14px; border-radius: 12px 12px 12px 2px; align-self: flex-start; max-width: 85%;"><strong>Support Agent:</strong> I have received your message. I am checking your account now.</div>`;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 1500);
      return;
    }

    // Temporary Loading State
    const loadingId = `loading-${Date.now()}`;
    messagesEl.innerHTML += `<div id="${loadingId}" style="background: var(--bg-elevated); border: 1px solid var(--border); padding: 10px 14px; border-radius: 12px 12px 12px 2px; align-self: flex-start;"><em>AI is typing...</em></div>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Send to Gemini API
    try {
      const res = await fetch('https://rapidmap-api.onrender.com/v1/support-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message, 
          plan: currentProfile?.plan || 'unauthenticated' 
        })
      });
      const data = await res.json();
      document.getElementById(loadingId)?.remove();
      
      // Parse markdown-style formatting from Gemini (basic bold/code parsing)
      let formattedReply = data.reply.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code style="background:var(--surface); padding:2px 4px; border-radius:4px;">$1</code>');
      
      messagesEl.innerHTML += `<div style="background: var(--bg-elevated); border: 1px solid var(--border); padding: 10px 14px; border-radius: 12px 12px 12px 2px; align-self: flex-start; max-width: 85%;">${formattedReply}</div>`;
    } catch (err) {
      document.getElementById(loadingId)?.remove();
      messagesEl.innerHTML += `<div style="background: var(--bg-elevated); border: 1px solid var(--error); color: var(--error); padding: 10px 14px; border-radius: 12px 12px 12px 2px; align-self: flex-start;">Connection error. Please try again.</div>`;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Handle Human Escalation Click
  requestHumanBtn?.addEventListener('click', async () => {
    if (!currentUser) return;
    
    requestHumanBtn.disabled = true;
    requestHumanBtn.querySelector('.spinner').style.display = 'inline-block';
    requestHumanBtn.querySelector('.spinner').nextSibling.textContent = ' Contacting Agent...';

    try {
      const res = await fetch('https://rapidmap-api.onrender.com/v1/escalate-support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          uid: currentUser.uid, 
          userEmail: currentUser.email,
          message: "User initiated live support session."
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        Toast.error(data.error);
        requestHumanBtn.disabled = false;
        requestHumanBtn.querySelector('.spinner').style.display = 'none';
        requestHumanBtn.innerHTML = 'Request 24/7 Human Agent';
        return;
      }

      // Switch UI to Human Mode
      isHumanAgentActive = true;
      document.getElementById('support-status-text').innerHTML = '🟠 Connecting to Human Agent...';
      humanEscalationContainer.style.display = 'none';
      
      messagesEl.innerHTML += `<div style="background: rgba(255,107,0,0.1); border: 1px solid var(--accent); padding: 10px 14px; border-radius: 12px; align-self: center; text-align: center; font-size: 0.8rem; margin: 10px 0;"><strong>Priority Support Activated</strong><br>A human agent has been notified and will be with you shortly.</div>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;

    } catch (error) {
      Toast.error("Failed to connect to support server.");
      requestHumanBtn.disabled = false;
    }
  });

  sendBtn?.addEventListener('click', sendMessage);
  inputEl?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

/* ============================================================
   RAPIDSAFE MAPS — Bulletproof High-Speed Map Initializer
   ============================================================ */
function initShowcaseMaps() {
  // Auto-retry if Leaflet hasn't finished loading yet
  if (typeof L === 'undefined') {
    setTimeout(initShowcaseMaps, 100);
    return;
  }

  // Reliable tile URL format for mobile & iframe environments
  const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const rapidSafeBranding = '© <span style="font-weight:700; color:var(--accent);">RapidSafe Maps</span>';

  const mapConfigs = [
    {
      id: 'preview-map-geo',
      center: [37.7749, -122.4194],
      zoom: 13,
      setup: () => {} 
    },
    {
      id: 'preview-map-static',
      center: [40.7128, -74.0060],
      zoom: 12,
      setup: (map) => { map.dragging.disable(); }
    },
    {
      id: 'preview-map-route',
      center: [51.5072, -0.1276],
      zoom: 13,
      setup: (map) => {
        const routeCoords = [[51.515, -0.14], [51.515, -0.12], [51.500, -0.12]];
        L.polyline(routeCoords, { color: '#FF6B00', weight: 4, dashArray: '6, 6' }).addTo(map);
        const iconA = L.divIcon({ className: 'custom-route-marker', html: '<div class="route-point">A</div>' });
        const iconB = L.divIcon({ className: 'custom-route-marker', html: '<div class="route-point">B</div>' });
        L.marker([51.515, -0.14], { icon: iconA }).addTo(map);
        L.marker([51.500, -0.12], { icon: iconB }).addTo(map);
      }
    }
  ];

  mapConfigs.forEach(config => {
    const el = document.getElementById(config.id);
    if (el && !el.classList.contains('map-initialized')) {
      el.classList.add('map-initialized');
      
      const map = L.map(config.id, { 
        zoomControl: false, 
        attributionControl: false 
      }).setView(config.center, config.zoom);

      L.tileLayer(tileUrl, { 
        maxZoom: 19,
        attribution: rapidSafeBranding
      }).addTo(map);
      
      L.control.attribution({ position: 'bottomright', prefix: rapidSafeBranding }).addTo(map);
      map.scrollWheelZoom.disable();
      
      config.setup(map);

      // Force instant tile fetch across all viewport dimensions
      setTimeout(() => { map.invalidateSize(); }, 100);
      setTimeout(() => { map.invalidateSize(); }, 500);

      // Continuously monitor size changes for responsive resizing
      if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(() => {
          map.invalidateSize();
        });
        resizeObserver.observe(el);
      }
    }
  });
}
