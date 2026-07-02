/* Creates a UPI-only Razorpay Payment Link for the signed-in user.
   POST /api/create-pro-payment-link  (Authorization: Bearer <Firebase ID token>) */

import { applyCors } from '../../lib/cors';
import { requireUser } from '../../lib/auth';

const PRO_PRICE_PAISE = 99900; // ₹999 — adjust to your pricing
const APP_URL = 'https://finresolver.in/v2/index.html';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let decoded;
  try {
    decoded = await requireUser(req);
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  const { uid, email, name } = decoded;
  const basicAuth = Buffer
    .from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`)
    .toString('base64');

  try {
    const resp = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        upi_link: true, // restricts checkout to UPI only (QR + intent + collect)
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
      res.status(502).json({ error: data?.error?.description || 'Could not create payment link.' });
      return;
    }

    res.status(200).json({ url: data.short_url, id: data.id });
  } catch (e) {
    res.status(500).json({ error: 'Payment link creation failed.' });
  }
}
