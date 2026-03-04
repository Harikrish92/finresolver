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
