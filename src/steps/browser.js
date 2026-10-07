import { chromium } from 'playwright';

/**
 * Execute a browser (Playwright) playbook step.
 *
 * Actions: goto, fill {selector,value}, click, waitFor (selector or {url}),
 * capture {var: {selector, attr?, value?, regex?, group?}}.
 * Headed via step.headed, playbook.headed, or FLOWBOOK_HEADED=1.
 * Reuses ctx.browser / ctx.page across browser steps in the same run.
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
