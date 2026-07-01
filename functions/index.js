/* ============================================================
   functions/index.js — FinResolver AI Advisor Pro backend
   FinResolver · finresolver.in

   Three Cloud Functions:
     createProPaymentLink — creates a UPI-only Razorpay Payment Link
                            for the signed-in user
     razorpayWebhook      — verifies Razorpay's webhook signature and
                            activates Pro on `payment_link.paid`
     advisorProxy         — server-funded Claude proxy, only reachable
                            by users with an active Pro subscription

   Required secrets (set with `firebase functions:secrets:set NAME`):
     RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
     ANTHROPIC_API_KEY
   ============================================================ */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const RAZORPAY_KEY_ID         = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET     = defineSecret('RAZORPAY_KEY_SECRET');
const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');
const ANTHROPIC_API_KEY       = defineSecret('ANTHROPIC_API_KEY');

const PRO_PRICE_PAISE   = 99900; // ₹999 — adjust to your pricing
const PRO_DURATION_DAYS = 365;   // one-time purchase, unlocks Pro for 1 year
const APP_URL           = 'https://finresolver.in/v2/index.html';

const ADVISOR_MODEL      = 'claude-sonnet-4-6';
const ADVISOR_MAX_TOKENS = 1000;

/* ─────────────────────────────────────────────────────────────
   1. Create a UPI-only Razorpay Payment Link for the caller
───────────────────────────────────────────────────────────── */
exports.createProPaymentLink = onCall(
  { secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const uid   = request.auth.uid;
    const email = request.auth.token.email || undefined;
    const name  = request.auth.token.name  || undefined;

    const basicAuth = Buffer
      .from(`${RAZORPAY_KEY_ID.value()}:${RAZORPAY_KEY_SECRET.value()}`)
      .toString('base64');

    const resp = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        upi_link: true, // restricts the checkout to UPI only (QR + intent + collect)
        amount: PRO_PRICE_PAISE,
        currency: 'INR',
        accept_partial: false,
        description: 'FinResolver AI Advisor Pro (1 year)',
        customer: { name, email },
        notify: { sms: false, email: !!email },
        reminder_enable: false,
        reference_id: `${uid}_${Date.now()}`,
        notes: { uid },
        callback_url: `${APP_URL}?pro=pending`,
        callback_method: 'get',
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      logger.error('Razorpay payment link creation failed', data);
      throw new HttpsError('internal', data?.error?.description || 'Could not create payment link.');
    }

    return { url: data.short_url, id: data.id };
  }
);

/* ─────────────────────────────────────────────────────────────
   2. Razorpay webhook — activates Pro on successful UPI payment
      Configure in Razorpay Dashboard → Settings → Webhooks:
        URL:    https://<region>-<project>.cloudfunctions.net/razorpayWebhook
        Events: payment_link.paid
───────────────────────────────────────────────────────────── */
exports.razorpayWebhook = onRequest(
  { secrets: [RAZORPAY_WEBHOOK_SECRET] },
  async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody;
    if (!signature || !rawBody) {
      res.status(400).send('Missing signature');
      return;
    }

    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET.value())
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      logger.warn('Rejected Razorpay webhook — signature mismatch');
      res.status(400).send('Invalid signature');
      return;
    }

    const event = req.body || {};
    if (event.event !== 'payment_link.paid') {
      res.status(200).send('ignored');
      return;
    }

    const uid       = event.payload?.payment_link?.entity?.notes?.uid;
    const paymentId = event.payload?.payment?.entity?.id || null;
    if (!uid) {
      logger.error('payment_link.paid webhook missing notes.uid', event);
      res.status(200).send('no uid');
      return;
    }

    const expiry = admin.firestore.Timestamp.fromMillis(
      Date.now() + PRO_DURATION_DAYS * 24 * 60 * 60 * 1000
    );

    await db.collection('users').doc(uid).set({
      pro: true,
      proSince: admin.firestore.FieldValue.serverTimestamp(),
      proExpiry: expiry,
      proPaymentId: paymentId,
    }, { merge: true });

    logger.info(`Pro activated for uid=${uid} (payment=${paymentId})`);
    res.status(200).send('ok');
  }
);

/* ─────────────────────────────────────────────────────────────
   3. Server-funded Advisor proxy — Pro users only.
      Client sends { system, messages } exactly as it would to
      api.anthropic.com/v1/messages; this forwards it using the
      app's own Anthropic key after verifying the caller's
      Pro subscription is active.
───────────────────────────────────────────────────────────── */
exports.advisorProxy = onCall(
  { secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const uid = request.auth.uid;

    const snap = await db.collection('users').doc(uid).get();
    const user = snap.data() || {};
    const isPro = user.pro === true
      && user.proExpiry
      && user.proExpiry.toMillis() > Date.now();

    if (!isPro) {
      throw new HttpsError('permission-denied', 'Active Pro subscription required.');
    }

    const { system, messages } = request.data || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages array is required.');
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY.value(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ADVISOR_MODEL,
        max_tokens: ADVISOR_MAX_TOKENS,
        system: system || undefined,
        messages,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      logger.error('Anthropic proxy error', data);
      if (resp.status === 429) {
        throw new HttpsError('resource-exhausted', 'Rate limited — please wait a moment.');
      }
      throw new HttpsError('internal', data?.error?.message || 'Advisor request failed.');
    }

    return { text: (data.content && data.content[0] && data.content[0].text) || '' };
  }
);
