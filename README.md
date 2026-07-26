# RapidSafe Maps 🌍

A secure, high-performance, and developer-first Maps API platform. RapidSafe Maps provides affordable routing, geocoding, places, and static map APIs designed as a drop-in alternative to legacy mapping providers.

## 🚀 Features

* **9 Core Endpoints:** Including Geocoding, Reverse Geocoding, Autocomplete, Places Search, Directions, Distance Matrix, Static Maps, Elevation, and Timezone.
* **Developer First:** Consistent JSON responses, predictable rate limits, and language-agnostic integration (cURL, JS, Python, PHP, Node.js).
* **Enterprise Security:** Secured endpoints with strict domain checking, secure API key generation, and role-based access control.
* **Live Dashboard:** Real-time analytics, latency tracking, API key management, and usage monitoring.
* **Integrated Payments:** Built-in Razorpay integration for seamless upgrades to Starter, Pro, Business, and Enterprise tiers.

## 🛠 Tech Stack

* **Frontend:** HTML5, Vanilla JavaScript (ES6 Modules), Custom CSS Design System
* **Backend Gateway:** Node.js, Express, Axios
* **Database & Auth:** Firebase Auth, Firestore
* **Mapping Engine:** Leaflet.js, OpenStreetMap integration
* **Payments:** Razorpay API
* **AI Support:** Google Gemini Flash integration for 24/7 technical support
* **Hosting:** Firebase Hosting (Frontend), Render (API Gateway)

## 💻 Local Development Setup

**1. Clone the repository:**
\`\`\`bash
git clone https://github.com/rapidsafe-3/RapidSafe-Maps.git
cd RapidSafe-Maps
\`\`\`

**2. Configure Firebase:**
Ensure you have the Firebase CLI installed and are logged into your account:
\`\`\`bash
firebase login
firebase init hosting
\`\`\`
*Select your existing project and set `.` as your public directory.*

**3. Run Locally:**
You can use any local server to test the frontend (e.g., Live Server in VS Code, or Python's HTTP server):
\`\`\`bash
python3 -m http.server 8000
\`\`\`
Visit `http://localhost:8000` in your browser.

## 🚢 Deployment

Deploying frontend updates to production takes seconds via Firebase Hosting:
\`\`\`bash
git add .
git commit -m "Your update message"
git push
firebase deploy --only hosting
\`\`\`

## 🔒 Security & Support
* If you discover a security vulnerability or need human support, navigate to your dashboard and utilize the **24/7 Human Escalation** protocol (available on Business & Enterprise plans).
* API keys are masked on the frontend and tracked securely via Firestore. Always utilize the "Allowed Domains" feature to lock down production keys.

---
*© 2026 RapidSafe Maps. Built for developers, everywhere.*
