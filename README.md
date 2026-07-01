# FinResolver — Financial Tracker
### finresolver.in

A single-page personal finance tracker with Google OAuth, per-user data isolation,
Excel/CSV import, and analytics charts.

---

## 📁 Project Structure

```
finresolver/
├── index.html              ← Entry point (HTML only, no logic)
│
├── css/
│   ├── variables.css       ← Design tokens, resets, animations
│   ├── login.css           ← Login / auth screen styles
│   ├── app.css             ← Header, layout, cards, tables, checklist, charts
│   └── import.css          ← Import modal styles
│
└── js/
    ├── auth.js             ← Google Identity Services OAuth wiring
    ├── data.js             ← Per-user localStorage store + month selectors
    ├── render.js           ← All DOM rendering (tables, charts, summary)
    ├── tracker.js          ← CRUD actions + keyboard event wiring
    └── import.js           ← Excel/CSV parsing, preview, confirm
```

---

## 🔐 Google OAuth Setup (one-time)

### 1. Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (e.g. **FinResolver**)
3. Navigate to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Fill in app name, support email, developer email
   - Scopes: add `email` and `profile`
4. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - **Authorised JavaScript origins:**
     ```
     https://finresolver.in
     http://localhost:3000    ← for local dev
     http://localhost:5500    ← if using Live Server
     ```
   - **Authorised redirect URIs:** (same as origins for One Tap)
     ```
     https://finresolver.in
     ```
5. Copy the generated **Client ID**

### 2. Paste it into auth.js

Open `js/auth.js` and replace:
```js
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com';
```
with your real Client ID:
```js
const GOOGLE_CLIENT_ID = '123456789-abcdefg.apps.googleusercontent.com';
```

That's it — no backend required. The GIS library handles the full OAuth flow.

---

## ✨ AI Advisor Pro — UPI Payment Setup (v2 only, one-time)

The v2 AI Advisor is BYOK by default (users paste their own Anthropic key).
**Pro** removes that requirement — FinResolver funds the Advisor for Pro users
after they pay a one-time UPI charge via a Razorpay **UPI-only Payment Link**.
Since the site itself is static (GitHub Pages), this needs three small
Firebase Cloud Functions in `functions/` to create the payment link, verify
Razorpay's webhook, and proxy Claude calls for Pro users only.

### 1. Upgrade the Firebase project to Blaze

Cloud Functions that make outbound network calls (to Razorpay/Anthropic)
require the pay-as-you-go **Blaze** plan. Firebase Console → your project →
Upgrade.

### 2. Get Razorpay credentials

1. Create/sign in to a [Razorpay](https://razorpay.com) account and complete KYC.
2. Dashboard → **Settings → API Keys** → generate `Key Id` / `Key Secret`.
3. Dashboard → **Settings → Webhooks** → add a webhook (URL from step 4 below),
   subscribe to the `payment_link.paid` event, and copy the **Webhook Secret**.

### 3. Set the Cloud Functions secrets

```bash
cd functions && npm install
firebase use --add          # pick your Firebase project (creates .firebaserc)
firebase functions:secrets:set RAZORPAY_KEY_ID
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
firebase functions:secrets:set ANTHROPIC_API_KEY   # FinResolver's own key, funds Pro usage
```

### 4. Deploy and register the webhook

```bash
firebase deploy --only functions
```

Copy the deployed `razorpayWebhook` URL (printed after deploy, looks like
`https://<region>-<project>.cloudfunctions.net/razorpayWebhook`) into the
Razorpay webhook you created in step 2.

### 5. Lock down the billing fields in Firestore

Add this to your Firestore security rules so a signed-in client can never
set their own `pro` flag directly — only the Cloud Functions (Admin SDK,
which bypasses rules) may write it:

```
match /users/{uid} {
  allow read: if request.auth.uid == uid;
  allow write: if request.auth.uid == uid
    && !('pro' in request.resource.data.diff(resource.data).affectedKeys())
    && !('proExpiry' in request.resource.data.diff(resource.data).affectedKeys())
    && !('proPaymentId' in request.resource.data.diff(resource.data).affectedKeys());
}
```

Pricing and validity period (`PRO_PRICE_PAISE`, `PRO_DURATION_DAYS`) live at
the top of `functions/index.js`.

---

## 🗄️ Data Storage

Data is stored in the browser's `localStorage` with this key structure:

```
fr_data_{google_uid}_{year}_{month}
```

For example:
```
fr_data_108234567890_2025_2   →  March 2025 for user 108234567890
fr_data_987654321000_2025_2   →  March 2025 for a different user
```

**Each Google account gets completely isolated data** — multiple people can use
the same browser without seeing each other's finances.

---

## 📊 Import Format (Standard)

Your Excel/CSV should match this layout:

| Col A | Col B | Col C | Col D | Col E | Col F | Col G | Col H | Col I |
|-------|-------|-------|-------|-------|-------|-------|-------|-------|
| Current Balance | `<amount>` | | | | | | | Monthly Checklist |
| Expense | | Income | | Investment | | Loan | | HDFC CC Payment |
| Description | Amount | Description | Amount | Description | Amount | Description | Amount | IDFC CC Payment |
| Rent | 15000 | Salary | 80000 | MF SIP | 5000 | Home Loan | 20000 | SC CC Payment |

Auto-Detect mode works with any sheet that has `Description` and `Amount` column pairs.

---

## 🚀 Deployment

This is a pure static site — host anywhere:

```bash
# Netlify (drag & drop the finresolver/ folder)
# Vercel
vercel deploy

# GitHub Pages
# Push to repo → Settings → Pages → Deploy from branch

# Any static host / CDN
# Just upload the folder and point your domain DNS to it
```

Make sure your domain (`https://finresolver.in`) is added to the
**Authorised JavaScript origins** in Google Cloud Console before going live.

---

## 🛠️ Local Development

```bash
# Using VS Code Live Server
# Right-click index.html → Open with Live Server

# Using Python
python -m http.server 3000

# Using Node
npx serve .
```

Visit `http://localhost:3000` (or whichever port). Add this origin to your
Google Cloud OAuth credentials as well.
