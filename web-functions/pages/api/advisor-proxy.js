/* Server-funded Advisor proxy — Pro users only.
   POST /api/advisor-proxy  (Authorization: Bearer <Firebase ID token>)
   Body: { system, messages } — forwarded to api.anthropic.com/v1/messages
   using the app's own Anthropic key, never exposed to the client. */

import { applyCors } from '../../lib/cors';
import { requireUser } from '../../lib/auth';
import { admin } from '../../lib/firebaseAdmin';

const ADVISOR_MODEL = 'claude-sonnet-4-6';
const ADVISOR_MAX_TOKENS = 1000;

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

  const snap = await admin.firestore().collection('users').doc(decoded.uid).get();
  const user = snap.data() || {};
  const isPro = user.pro === true
    && user.proExpiry
    && user.proExpiry.toMillis() > Date.now();

  if (!isPro) {
    res.status(403).json({ error: 'Active Pro subscription required.' });
    return;
  }

  const { system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required.' });
    return;
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
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
      if (resp.status === 429) {
        res.status(429).json({ error: 'Rate limited — please wait a moment.' });
        return;
      }
      res.status(502).json({ error: data?.error?.message || 'Advisor request failed.' });
      return;
    }

    res.status(200).json({ text: (data.content && data.content[0] && data.content[0].text) || '' });
  } catch (e) {
    res.status(500).json({ error: 'Advisor request failed.' });
  }
}
