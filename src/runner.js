import { runHttpStep } from './steps/http.js';
import { runAssertStep } from './steps/assert.js';
import { runBrowserStep, closeBrowser } from './steps/browser.js';

const BUILTINS = {
  TIMESTAMP: () => String(Date.now()),
  UUID: () => crypto.randomUUID(),
};

const KNOWN_TYPES = ['http', 'assert', 'browser'];

/**
 * Validate a parsed playbook document. Returns an array of issue strings.
 */
export function validatePlaybook(doc) {
  const issues = [];
  if (!doc || typeof doc !== 'object') {
    return ['playbook must be a YAML mapping'];
  }
  if (!doc.name || typeof doc.name !== 'string') {
    issues.push('missing string field: name');
  }
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    issues.push('steps must be a non-empty array');
  } else {
    doc.steps.forEach((step, i) => {
      if (!step || typeof step !== 'object') {
        issues.push(`steps[${i}] must be an object`);
        return;
      }
      if (!step.id) issues.push(`steps[${i}] missing id`);
      if (!step.type) issues.push(`steps[${i}] (id=${step.id || '?'}) missing type`);
      else if (!KNOWN_TYPES.includes(step.type)) {
        issues.push(`steps[${i}] (id=${step.id}) unknown type: ${step.type}`);
      }
      if (step.type === 'http') {
        if (!step.method) issues.push(`steps[${i}] (id=${step.id}) http missing method`);
        if (!step.path) issues.push(`steps[${i}] (id=${step.id}) http missing path`);
      }
      if (step.type === 'assert' && !step.expect) {
        issues.push(`steps[${i}] (id=${step.id}) assert missing expect`);
      }
      if (step.type === 'browser') {
        if (!Array.isArray(step.actions) || step.actions.length === 0) {
          issues.push(`steps[${i}] (id=${step.id}) browser missing non-empty actions`);
        }
      }
    });
  }
  return issues;
}

/**
 * Resolve ${VAR} and ${VAR:-default} against vars + env + builtins.
 */
export function interpolate(value, ctx) {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => interpolate(v, ctx));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolate(v, ctx);
    }
    return out;
  }
  if (typeof value !== 'string') return value;

  // Whole-string substitution keeps non-string types (objects/numbers) when exact match
  const whole = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$/);
  if (whole) {
    const [, key, def] = whole;
    if (Object.prototype.hasOwnProperty.call(ctx.vars, key)) return ctx.vars[key];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) return process.env[key];
    if (BUILTINS[key]) return BUILTINS[key]();
    if (def !== undefined) return def;
    return '';
  }

  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, key, def) => {
    if (Object.prototype.hasOwnProperty.call(ctx.vars, key)) return String(ctx.vars[key]);
    if (Object.prototype.hasOwnProperty.call(process.env, key)) return String(process.env[key]);
    if (BUILTINS[key]) return String(BUILTINS[key]());
    if (def !== undefined) return def;
    return '';
  });
}

/**
 * Resolve a simple JSONPath-like selector: $.a.b[0].c
 */
export function getJsonPath(data, path) {
  if (!path || path === '$') return data;
  if (!path.startsWith('$.')) {
    throw new Error(`JSON path must start with $.: got ${path}`);
  }
  const parts = path
    .slice(2)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function resolveBaseUrl(doc, override) {
  if (override) return override.replace(/\/$/, '');
  const raw = doc.baseUrl ?? '${BASE_URL:-http://127.0.0.1:3847}';
  const ctx = { vars: {} };
  return String(interpolate(raw, ctx)).replace(/\/$/, '');
}

/**
 * Execute a playbook sequentially.
 */
export async function runPlaybook(doc, options = {}) {
  const issues = validatePlaybook(doc);
  if (issues.length) {
    throw new Error(`Invalid playbook:\n  - ${issues.join('\n  - ')}`);
  }

  const baseUrl = resolveBaseUrl(doc, options.baseUrlOverride);
  const vars = {};
  // Seed vars from playbook (with interpolation against env/builtins first)
  const seedCtx = { vars: {} };
  for (const [k, v] of Object.entries(doc.vars || {})) {
    vars[k] = interpolate(v, seedCtx);
    seedCtx.vars[k] = vars[k];
  }

  const ctx = {
    vars,
    baseUrl,
    lastResponse: null,
    playbookHeaded: doc.headed === true,
    browser: null,
    context: null,
    page: null,
  };
  const stepResults = [];
  let passed = 0;

  try {
    for (const step of doc.steps) {
      const started = Date.now();
      const entry = {
        id: step.id,
        type: step.type,
        ok: false,
        durationMs: 0,
        detail: '',
        error: null,
        captures: {},
      };

      try {
        let outcome;
        if (step.type === 'http') {
          outcome = await runHttpStep(step, ctx, interpolate, getJsonPath);
        } else if (step.type === 'assert') {
          outcome = await runAssertStep(step, ctx, interpolate, getJsonPath);
        } else if (step.type === 'browser') {
          outcome = await runBrowserStep(step, ctx, interpolate);
        } else {
          throw new Error(`Unknown step type: ${step.type}`);
        }

        entry.ok = outcome.ok;
        entry.detail = outcome.detail || '';
        entry.captures = outcome.captures || {};
        entry.error = outcome.error || null;

        // Merge captures into vars
        for (const [k, v] of Object.entries(entry.captures)) {
          ctx.vars[k] = v;
        }
      } catch (err) {
        entry.ok = false;
        entry.error = err.message;
      }

      entry.durationMs = Date.now() - started;
      stepResults.push(entry);
      if (entry.ok) passed += 1;
      else break; // fail-fast
    }
  } finally {
    await closeBrowser(ctx);
  }

  return {
    name: doc.name,
    baseUrl,
    ok: passed === doc.steps.length,
    passed,
    total: doc.steps.length,
    steps: stepResults,
  };
}
