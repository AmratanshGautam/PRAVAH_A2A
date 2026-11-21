import crypto from 'crypto';

function getSecret() {
  return process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update((process.env.GEMINI_API_KEY || 'pravah-btp') + '-hmac-secret').digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  return keyBuf.length === derived.length && crypto.timingSafeEqual(keyBuf, derived);
}

export function signToken(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 8 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
