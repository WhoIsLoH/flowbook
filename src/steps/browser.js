import { chromium } from 'playwright';

/**
 * Execute a browser (Playwright) playbook step.
 *
 * Actions: goto, fill {selector,value}, click, waitFor (selector or {url}),
 * capture {var: {selector, attr?, value?, regex?, group?}}.
 * Headed via step.headed, playbook.headed, or FLOWBOOK_HEADED=1.
 * Reuses ctx.browser / ctx.page across browser steps in the same run.
 *
 * Optional step.session { cookies, headers, localStorage } is applied to the
 * browser context before the actions run (see applySession). Session state
 * stays on the shared context for later browser steps in the same run.
 */
export async function runBrowserStep(step, ctx, interpolate) {
  const headed =
    step.headed === true ||
    ctx.playbookHeaded === true ||
    process.env.FLOWBOOK_HEADED === '1' ||
    process.env.FLOWBOOK_HEADED === 'true';

  const actions = Array.isArray(step.actions) ? step.actions : [];
  if (actions.length === 0) {
    return {
      ok: false,
      detail: 'browser',
      error: 'browser step requires a non-empty actions array',
      captures: {},
    };
  }

  const page = await ensurePage(ctx, headed);
  const captures = {};
  const summaries = [];

  if (step.session != null) {
    try {
      const label = await applySession(ctx, interpolate(step.session, ctx));
      summaries.push(label);
    } catch (err) {
      return fail(summaries, captures, `session: ${err.message}`);
    }
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action || typeof action !== 'object') {
      return fail(summaries, captures, `actions[${i}] must be an object`);
    }

    try {
      if ('goto' in action) {
        const raw = String(interpolate(action.goto, ctx));
        const url = resolveUrl(raw, ctx.baseUrl);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        summaries.push(`goto ${url}`);
      } else if ('fill' in action) {
        const spec = normalizeFill(action.fill, interpolate, ctx);
        await page.fill(spec.selector, spec.value);
        summaries.push(`fill ${spec.selector}`);
      } else if ('click' in action) {
        const selector = normalizeSelector(action.click, interpolate, ctx);
        await page.click(selector);
        summaries.push(`click ${selector}`);
      } else if ('waitFor' in action) {
        const label = await runWaitFor(page, action.waitFor, interpolate, ctx);
        summaries.push(`waitFor ${label}`);
      } else if ('capture' in action) {
        const got = await runCapture(page, action.capture, interpolate, ctx);
        Object.assign(captures, got);
        for (const [k, v] of Object.entries(got)) {
          ctx.vars[k] = v;
        }
        summaries.push(`capture ${Object.keys(got).join(',')}`);
      } else {
        const keys = Object.keys(action).join(',');
        return fail(summaries, captures, `actions[${i}] unknown action keys: ${keys}`);
      }
    } catch (err) {
      return fail(summaries, captures, `actions[${i}] ${err.message}`);
    }
  }

  // Optional step-level capture after all actions
  if (step.capture && typeof step.capture === 'object') {
    try {
      const got = await runCapture(page, step.capture, interpolate, ctx);
      Object.assign(captures, got);
      for (const [k, v] of Object.entries(got)) {
        ctx.vars[k] = v;
      }
      summaries.push(`capture ${Object.keys(got).join(',')}`);
    } catch (err) {
      return fail(summaries, captures, `capture: ${err.message}`);
    }
  }

  return {
    ok: true,
    detail: summaries.join(' → '),
    error: null,
    captures,
  };
}

export async function closeBrowser(ctx) {
  if (ctx?.browser) {
    try {
      await ctx.browser.close();
    } catch {
      // ignore close errors
    }
    ctx.browser = null;
    ctx.context = null;
    ctx.page = null;
    ctx.sessionHeaders = null;
  }
}

const SESSION_KEYS = ['cookies', 'headers', 'localStorage'];
const COOKIE_KEYS = ['name', 'value', 'url', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'];
const SAME_SITE = ['Strict', 'Lax', 'None'];

/**
 * Static shape check for a browser step's `session` block (used by validate).
 * Returns an array of issue strings.
 */
export function validateSession(session) {
  const issues = [];
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return ['session must be a mapping with cookies / headers / localStorage'];
  }
  for (const key of Object.keys(session)) {
    if (!SESSION_KEYS.includes(key)) issues.push(`session has unknown key: ${key}`);
  }
  if (session.cookies != null) {
    if (!Array.isArray(session.cookies)) {
      issues.push('session.cookies must be a list');
    } else {
      session.cookies.forEach((c, i) => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
          issues.push(`session.cookies[${i}] must be a mapping`);
          return;
        }
        if (c.name == null || c.name === '') issues.push(`session.cookies[${i}] missing name`);
        if (c.value == null) issues.push(`session.cookies[${i}] missing value`);
        if (c.url != null && (c.domain != null || c.path != null)) {
          issues.push(`session.cookies[${i}] use either url or domain/path, not both`);
        }
        for (const k of Object.keys(c)) {
          if (!COOKIE_KEYS.includes(k)) issues.push(`session.cookies[${i}] unknown key: ${k}`);
        }
      });
    }
  }
  for (const key of ['headers', 'localStorage']) {
    const v = session[key];
    if (v != null && (typeof v !== 'object' || Array.isArray(v))) {
      issues.push(`session.${key} must be a mapping`);
    }
  }
  return issues;
}

/**
 * Apply an (already interpolated) session block to ctx.context.
 *
 * - cookies: context.addCookies; url defaults to baseUrl when no url/domain.
 * - headers: added only to requests whose origin matches baseUrl (via a
 *   context route). Merged across steps; a null or empty value removes a header.
 * - localStorage: set for the baseUrl origin through an init script, so it is
 *   in place before the app's own scripts run on the next navigation. If the
 *   current page is already on that origin it is also written right away.
 *
 * Returns a summary label without secret values.
 */
async function applySession(ctx, session) {
  const issues = validateSession(session);
  if (issues.length) throw new Error(issues.join('; '));

  const context = ctx.context;
  const origin = baseOrigin(ctx.baseUrl);
  const parts = [];

  if (Array.isArray(session.cookies) && session.cookies.length) {
    const cookies = session.cookies.map((c, i) => toPlaywrightCookie(c, i, ctx.baseUrl));
    await context.addCookies(cookies);
    parts.push(`cookies=${cookies.map((c) => c.name).join(',')}`);
  }

  if (session.headers && Object.keys(session.headers).length) {
    if (!origin) throw new Error('headers need an http(s) baseUrl to scope them to');
    if (!ctx.sessionHeaders) {
      ctx.sessionHeaders = {};
      await context.route(
        (url) => url.origin === origin,
        async (route) => {
          const extra = ctx.sessionHeaders || {};
          if (Object.keys(extra).length === 0) return route.fallback();
          const headers = { ...(await route.request().allHeaders()) };
          for (const [k, v] of Object.entries(extra)) headers[k] = v;
          return route.fallback({ headers });
        },
      );
    }
    for (const [name, value] of Object.entries(session.headers)) {
      const key = name.toLowerCase();
      if (value == null || value === '') delete ctx.sessionHeaders[key];
      else ctx.sessionHeaders[key] = String(value);
    }
    parts.push(`headers=${Object.keys(session.headers).join(',')}`);
  }

  if (session.localStorage && Object.keys(session.localStorage).length) {
    if (!origin) throw new Error('localStorage needs an http(s) baseUrl');
    const items = {};
    for (const [k, v] of Object.entries(session.localStorage)) {
      items[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    ctx.sessionSeq = (ctx.sessionSeq || 0) + 1;
    const marker = `__flowbook_session_${ctx.sessionSeq}`;
    // Applied once per tab (marker in sessionStorage), so the app can still
    // change or clear these keys later without them coming back on reload.
    await context.addInitScript(
      ({ origin: o, items: it, marker: m }) => {
        try {
          if (window.location.origin !== o) return;
          if (window.sessionStorage.getItem(m)) return;
          for (const [k, v] of Object.entries(it)) window.localStorage.setItem(k, v);
          window.sessionStorage.setItem(m, '1');
        } catch {
          // storage blocked (e.g. opaque origin): ignore
        }
      },
      { origin, items, marker },
    );
    const page = ctx.page;
    if (page && safeOrigin(page.url()) === origin) {
      await page.evaluate(
        ({ items: it, marker: m }) => {
          for (const [k, v] of Object.entries(it)) window.localStorage.setItem(k, v);
          window.sessionStorage.setItem(m, '1');
        },
        { items, marker },
      );
    }
    parts.push(`localStorage=${Object.keys(items).join(',')}`);
  }

  return `session ${parts.join(' ') || '(empty)'}`;
}

function toPlaywrightCookie(c, i, baseUrl) {
  const value = c.value == null ? '' : String(c.value);
  if (value === '') {
    throw new Error(`cookies[${i}] (${c.name}) resolved to an empty value; was the var captured?`);
  }
  const cookie = { name: String(c.name), value };
  if (c.url != null) {
    cookie.url = resolveUrl(String(c.url), baseUrl);
  } else if (c.domain != null) {
    cookie.domain = String(c.domain);
    cookie.path = c.path != null ? String(c.path) : '/';
  } else {
    if (!baseOrigin(baseUrl)) throw new Error(`cookies[${i}] needs url or domain (no http(s) baseUrl)`);
    if (c.path != null) {
      // Playwright does not take url + path together: use host + path instead.
      cookie.domain = new URL(baseUrl).hostname;
      cookie.path = String(c.path);
    } else {
      cookie.url = `${baseOrigin(baseUrl)}/`;
    }
  }
  if (c.expires != null) cookie.expires = Number(c.expires);
  if (c.httpOnly != null) cookie.httpOnly = c.httpOnly === true || c.httpOnly === 'true';
  if (c.secure != null) cookie.secure = c.secure === true || c.secure === 'true';
  if (c.sameSite != null) {
    const s = String(c.sameSite);
    const norm = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (!SAME_SITE.includes(norm)) throw new Error(`cookies[${i}] sameSite must be Strict, Lax or None`);
    cookie.sameSite = norm;
  }
  return cookie;
}

function baseOrigin(baseUrl) {
  return safeOrigin(baseUrl);
}

function safeOrigin(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

async function ensurePage(ctx, headed) {
  if (ctx.page) return ctx.page;
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext();
  const page = await context.newPage();
  ctx.browser = browser;
  ctx.context = context;
  ctx.page = page;
  return page;
}

function resolveUrl(pathOrUrl, baseUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = String(baseUrl || '').replace(/\/$/, '');
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

function normalizeSelector(raw, interpolate, ctx) {
  if (typeof raw === 'string') return String(interpolate(raw, ctx));
  if (raw && typeof raw === 'object' && raw.selector != null) {
    return String(interpolate(raw.selector, ctx));
  }
  throw new Error('click requires a selector string or { selector }');
}

function normalizeFill(raw, interpolate, ctx) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('fill requires { selector, value }');
  }
  const selector = String(interpolate(raw.selector, ctx));
  const value = String(interpolate(raw.value ?? '', ctx));
  if (!selector) throw new Error('fill missing selector');
  return { selector, value };
}

async function runWaitFor(page, raw, interpolate, ctx) {
  if (typeof raw === 'string') {
    const selector = String(interpolate(raw, ctx));
    await page.waitForSelector(selector, { state: 'visible' });
    return selector;
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('waitFor requires a selector string or { selector | url }');
  }
  if (raw.url != null) {
    const url = String(interpolate(raw.url, ctx));
    await page.waitForURL(url);
    return `url=${url}`;
  }
  if (raw.selector != null) {
    const selector = String(interpolate(raw.selector, ctx));
    const state = raw.state ? String(interpolate(raw.state, ctx)) : 'visible';
    await page.waitForSelector(selector, { state });
    return selector;
  }
  throw new Error('waitFor requires selector or url');
}

async function runCapture(page, captureMap, interpolate, ctx) {
  const out = {};
  for (const [name, spec] of Object.entries(captureMap || {})) {
    if (typeof spec === 'string') {
      // Shorthand: selector → textContent
      const selector = String(interpolate(spec, ctx));
      const text = await page.locator(selector).first().textContent();
      out[name] = (text ?? '').trim();
      continue;
    }
    if (!spec || typeof spec !== 'object') {
      throw new Error(`capture ${name}: expected string selector or object spec`);
    }

    let text = '';
    if (spec.selector != null) {
      const selector = String(interpolate(spec.selector, ctx));
      const loc = page.locator(selector).first();
      if (spec.value === true) {
        text = await loc.inputValue();
      } else if (spec.attr != null) {
        const attr = String(interpolate(spec.attr, ctx));
        text = (await loc.getAttribute(attr)) ?? '';
      } else {
        text = (await loc.textContent()) ?? '';
      }
    } else {
      text = await page.locator('body').innerText();
    }

    text = String(text).trim();

    if (spec.regex != null) {
      const pattern = String(interpolate(spec.regex, ctx));
      const re = new RegExp(pattern);
      const m = text.match(re);
      if (!m) {
        throw new Error(`capture ${name}: regex ${pattern} did not match`);
      }
      const group = spec.group != null ? Number(spec.group) : 1;
      out[name] = m[group] ?? m[0];
    } else {
      out[name] = text;
    }
  }
  return out;
}

function fail(summaries, captures, error) {
  return {
    ok: false,
    detail: summaries.join(' → ') || 'browser',
    error,
    captures,
  };
}
