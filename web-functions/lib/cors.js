const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://finresolver.in';

/* Applies CORS headers and short-circuits the preflight OPTIONS request.
   Returns true if the caller should stop (preflight already answered). */
export function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
