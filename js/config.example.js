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
  // Base URL of the deployed web-functions/ Vercel project (AI Advisor Pro backend)
  apiBase: 'https://YOUR_PROJECT.vercel.app',
};
