/* ============================================================
   config.example.js — Template for local development
   FinResolver · finresolver.in

   Copy this file to config.js and fill in your own values.
   config.js is gitignored — never commit real credentials.

   Google OAuth Client ID:
     https://console.cloud.google.com/ → APIs & Services → Credentials
   Firebase project config:
     https://console.firebase.google.com/ → Project settings → Your apps
   ============================================================ */

window.FINRESOLVER_CONFIG = {
  googleClientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  firebase: {
    apiKey:            'YOUR_FIREBASE_API_KEY',
    authDomain:        'YOUR_PROJECT.firebaseapp.com',
    projectId:         'YOUR_PROJECT',
    storageBucket:     'YOUR_PROJECT.firebasestorage.app',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId:             'YOUR_APP_ID',
  },
  // Razorpay: create an account at razorpay.com, copy your Key ID from
  // Settings → API Keys. The Key Secret goes in the Firebase Function env only.
  razorpayKey: 'YOUR_RAZORPAY_KEY_ID',
};
