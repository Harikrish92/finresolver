import { admin } from './firebaseAdmin';

/* Verifies the Firebase ID token sent as `Authorization: Bearer <token>`.
   Throws an Error with a `status` property on failure. */
export async function requireUser(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error('Sign in required.');
    err.status = 401;
    throw err;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    const err = new Error('Invalid or expired session.');
    err.status = 401;
    throw err;
  }
}
