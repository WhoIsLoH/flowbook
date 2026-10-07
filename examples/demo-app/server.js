/**
 * Minimal Express stub for Flowbook MVP playbooks.
 * Journeys: signup → verify → checkout (mock Stripe) → /me plan=premium
 */
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 3847);
const app = express();
app.use(express.json());

/** @type {Map<string, { email: string, passwordHash: string, verified: boolean, plan: string, verifyToken: string | null, sessionToken: string | null }>} */
const usersByEmail = new Map();
/** @type {Map<string, string>} email keyed by verify token */
const verifyTokens = new Map();
/** @type {Map<string, string>} email keyed by session token */
const sessions = new Map();

function hashPassword(password) {
  return createHash('sha256').update(String(password)).digest('hex');
}

function token() {
  return randomBytes(16).toString('hex');
}

function authEmail(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return sessions.get(m[1]) || null;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'flowbook-demo-app' });
});

app.post('/signup', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  if (usersByEmail.has(email)) {
    return res.status(409).json({ error: 'user already exists' });
  }

  const verifyToken = token();
  const sessionToken = token();
  const user = {
    email,
    passwordHash: hashPassword(password),
    verified: false,
    plan: 'free',
    verifyToken,
    sessionToken,
  };
  usersByEmail.set(email, user);
  verifyTokens.set(verifyToken, email);
  sessions.set(sessionToken, email);

  return res.status(201).json({
    ok: true,
    email,
    status: 'pending',
    verifyToken,
    sessionToken,
  });
});

app.post('/verify', (req, res) => {
  const { token: verifyToken } = req.body || {};
  if (!verifyToken) {
    return res.status(400).json({ error: 'token required' });
  }
  const email = verifyTokens.get(verifyToken);
  if (!email) {
    return res.status(400).json({ error: 'invalid or expired token' });
  }
  const user = usersByEmail.get(email);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }
  user.verified = true;
  user.verifyToken = null;
  verifyTokens.delete(verifyToken);

  // Ensure session exists
  if (!user.sessionToken || !sessions.has(user.sessionToken)) {
    user.sessionToken = token();
    sessions.set(user.sessionToken, email);
  }

  return res.json({
    ok: true,
    email,
    verified: true,
    sessionToken: user.sessionToken,
  });
});

app.post('/checkout', (req, res) => {
  const email = authEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const user = usersByEmail.get(email);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }
  if (!user.verified) {
    return res.status(403).json({ error: 'email not verified' });
  }

  // Mock Stripe Checkout success
  user.plan = 'premium';
  return res.json({
    ok: true,
    provider: 'stripe-mock',
    checkoutSessionId: `cs_test_${token().slice(0, 12)}`,
    plan: user.plan,
  });
});

app.get('/me', (req, res) => {
  const email = authEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const user = usersByEmail.get(email);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }
  return res.json({
    email: user.email,
    verified: user.verified,
    plan: user.plan,
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`flowbook demo-app listening on http://127.0.0.1:${PORT}`);
});
