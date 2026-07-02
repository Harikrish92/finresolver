/* Verifies Razorpay's webhook signature and activates Pro on payment_link.paid.
   Configure in Razorpay Dashboard → Settings → Webhooks:
     URL:    https://<your-project>.vercel.app/api/razorpay-webhook
     Events: payment_link.paid */

import crypto from 'crypto';
import { admin } from '../../lib/firebaseAdmin';

// Signature verification needs the exact raw bytes Razorpay sent.
export const config = {
  api: { bodyParser: false },
};

const PRO_DURATION_DAYS = 365; // one-time purchase, unlocks Pro for 1 year

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    res.status(400).send('Missing signature');
    return;
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (expected !== signature) {
    res.status(400).send('Invalid signature');
    return;
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  if (event.event !== 'payment_link.paid') {
    res.status(200).send('ignored');
    return;
  }

  const uid = event.payload?.payment_link?.entity?.notes?.uid;
  const paymentId = event.payload?.payment?.entity?.id || null;
  if (!uid) {
    res.status(200).send('no uid');
    return;
  }

  const expiry = admin.firestore.Timestamp.fromMillis(
    Date.now() + PRO_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  await admin.firestore().collection('users').doc(uid).set({
    pro: true,
    proSince: admin.firestore.FieldValue.serverTimestamp(),
    proExpiry: expiry,
    proPaymentId: paymentId,
  }, { merge: true });

  res.status(200).send('ok');
}
