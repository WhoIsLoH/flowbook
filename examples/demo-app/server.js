/**
 * Minimal Express stub for Flowbook MVP playbooks.
 * Journeys: signup → verify → checkout (mock Stripe) → /me plan=premium
 * Also serves a tiny HTML UI at /, /verify, /checkout, /account for browser steps.
 */
import express from 'express';
import { randomBytes, createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 3847);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Flowbook demo</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #111; }
    body { max-width: 420px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.9rem; }
    input { width: 100%; padding: 0.5rem; box-sizing: border-box; }
    button { margin-top: 1rem; padding: 0.55rem 1rem; cursor: pointer; }
    .msg { margin-top: 1rem; padding: 0.75rem; background: #f4f4f5; border-radius: 6px; }
    .err { background: #fee2e2; }
    .ok { background: #dcfce7; }
    a { color: #2563eb; }
    [data-plan] { font-weight: 700; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'flowbook-demo-app' });
});

/* ── HTML UI ─────────────────────────────────────────────────────────────── */

app.get('/', (_req, res) => {
  res.type('html').send(
    layout(
      'Signup',
      `<h1>Sign up</h1>
<form id="signup-form" method="post" action="/ui/signup">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required autocomplete="username" />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required autocomplete="new-password" />
  <button id="signup-btn" type="submit">Create account</button>
</form>
<p class="msg">Already have a token? <a href="/verify">Verify email</a></p>`,
    ),
  );
});

app.post('/ui/signup', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).type('html').send(
      layout('Signup error', `<div class="msg err" id="error">email and password required</div><p><a href="/">Back</a></p>`),
    );
  }
  if (usersByEmail.has(email)) {
    return res.status(409).type('html').send(
      layout('Signup error', `<div class="msg err" id="error">user already exists</div><p><a href="/">Back</a></p>`),
    );
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

  // Cookie so subsequent UI pages can auth without Bearer headers
  res.setHeader(
    'Set-Cookie',
    `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
  );

  return res.type('html').send(
    layout(
      'Check your email',
      `<h1>Check your email</h1>
<div class="msg ok" id="signup-success">
  Account created for <strong id="signup-email">${escapeHtml(email)}</strong>.
  Use the verification token below (demo stand-in for an email link).
</div>
<p>Verify token:
  <code id="verify-token" data-verify-token="${escapeHtml(verifyToken)}">${escapeHtml(verifyToken)}</code>
</p>
<p><a id="goto-verify" href="/verify">Continue to verify</a></p>`,
    ),
  );
});

app.get('/verify', (_req, res) => {
  res.type('html').send(
    layout(
      'Verify email',
      `<h1>Verify email</h1>
<form id="verify-form" method="post" action="/ui/verify">
  <label for="token">Verification token</label>
  <input id="token" name="token" type="text" required />
  <button id="verify-btn" type="submit">Verify</button>
</form>
<p><a href="/">Back to signup</a></p>`,
    ),
  );
});

app.post('/ui/verify', (req, res) => {
  const { token: verifyToken } = req.body || {};
  if (!verifyToken) {
    return res.status(400).type('html').send(
      layout('Verify error', `<div class="msg err" id="error">token required</div><p><a href="/verify">Back</a></p>`),
    );
  }
  const email = verifyTokens.get(verifyToken);
  if (!email) {
    return res.status(400).type('html').send(
      layout('Verify error', `<div class="msg err" id="error">invalid or expired token</div><p><a href="/verify">Back</a></p>`),
    );
  }
  const user = usersByEmail.get(email);
  if (!user) {
    return res.status(404).type('html').send(
      layout('Verify error', `<div class="msg err" id="error">user not found</div>`),
    );
  }
  user.verified = true;
  user.verifyToken = null;
  verifyTokens.delete(verifyToken);

  if (!user.sessionToken || !sessions.has(user.sessionToken)) {
    user.sessionToken = token();
    sessions.set(user.sessionToken, email);
  }

  res.setHeader(
    'Set-Cookie',
    `session=${user.sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
  );

  return res.redirect(303, '/checkout');
});

app.get('/checkout', (req, res) => {
  const email = sessionEmailFromCookie(req);
  if (!email) {
    return res.status(401).type('html').send(
      layout('Checkout', `<div class="msg err" id="error">Please sign up first.</div><p><a href="/">Signup</a></p>`),
    );
  }
  const user = usersByEmail.get(email);
  if (!user?.verified) {
    return res.status(403).type('html').send(
      layout('Checkout', `<div class="msg err" id="error">Email not verified.</div><p><a href="/verify">Verify</a></p>`),
    );
  }

  res.type('html').send(
    layout(
      'Checkout',
      `<h1>Upgrade to Premium</h1>
<p>Signed in as <strong id="checkout-email">${escapeHtml(email)}</strong>. Current plan: <span data-plan="${escapeHtml(user.plan)}">${escapeHtml(user.plan)}</span></p>
<form id="checkout-form" method="post" action="/ui/checkout">
  <button id="checkout-btn" type="submit">Pay with Stripe (mock)</button>
</form>`,
    ),
  );
});

app.post('/ui/checkout', (req, res) => {
  const email = sessionEmailFromCookie(req);
  if (!email) {
    return res.status(401).type('html').send(
      layout('Checkout error', `<div class="msg err" id="error">unauthorized</div>`),
    );
  }
  const user = usersByEmail.get(email);
  if (!user) {
    return res.status(404).type('html').send(
      layout('Checkout error', `<div class="msg err" id="error">user not found</div>`),
    );
  }
  if (!user.verified) {
    return res.status(403).type('html').send(
      layout('Checkout error', `<div class="msg err" id="error">email not verified</div>`),
    );
  }

  user.plan = 'premium';
  return res.redirect(303, '/account');
});

app.get('/account', (req, res) => {
  const email = sessionEmailFromCookie(req);
  if (!email) {
    return res.status(401).type('html').send(
      layout('Account', `<div class="msg err" id="error">Please sign up first.</div><p><a href="/">Signup</a></p>`),
    );
  }
  const user = usersByEmail.get(email);
  if (!user) {
    return res.status(404).type('html').send(
      layout('Account', `<div class="msg err" id="error">user not found</div>`),
    );
  }

  res.type('html').send(
    layout(
      'Account',
      `<h1>Your account</h1>
<div class="msg ok" id="account-panel">
  <p>Email: <span id="account-email">${escapeHtml(user.email)}</span></p>
  <p>Verified: <span id="account-verified">${user.verified ? 'yes' : 'no'}</span></p>
  <p>Plan: <span id="account-plan" data-plan="${escapeHtml(user.plan)}">${escapeHtml(user.plan)}</span></p>
</div>
<p><a href="/">Home</a></p>`,
    ),
  );
});

function sessionEmailFromCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return null;
  return sessions.get(m[1]) || null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── JSON API (unchanged contract for HTTP playbooks) ───────────────────── */

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
