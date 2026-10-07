import { runHttpStep } from './http.js';

/**
 * Assert step: optionally run an inline HTTP request, then check
 * expect.status / expect.json / expect.equals against lastResponse,
 * and/or expect.vars against playbook vars (e.g. browser captures).
 */
export async function runAssertStep(step, ctx, interpolate, getJsonPath) {
  if (step.http) {
    const httpStep = {
      id: `${step.id}:http`,
      type: 'http',
      method: step.http.method || 'GET',
      path: step.http.path,
      headers: step.http.headers,
      body: step.http.body,
      capture: step.http.capture,
    };
    const httpResult = await runHttpStep(httpStep, ctx, interpolate, getJsonPath);
    if (!httpResult.ok) {
      return {
        ok: false,
        detail: httpResult.detail,
        error: httpResult.error || 'assert HTTP prelude failed',
        captures: httpResult.captures || {},
      };
    }
    for (const [k, v] of Object.entries(httpResult.captures || {})) {
      ctx.vars[k] = v;
    }
  }

  const expect = step.expect || {};
  const details = [];
  const hasVars = expect.vars && typeof expect.vars === 'object';
  const hasHttpExpect =
    expect.status != null ||
    (expect.json && typeof expect.json === 'object') ||
    expect.equals !== undefined;

  if (!hasVars && !hasHttpExpect) {
    return {
      ok: false,
      detail: 'assert',
      error: 'assert expect needs status, json, equals, and/or vars',
      captures: {},
    };
  }

  if (hasVars) {
    const wanted = interpolate(expect.vars, ctx);
    for (const [key, want] of Object.entries(wanted)) {
      const got = ctx.vars[key];
      if (!deepEqual(got, want)) {
        return {
          ok: false,
          detail: details.join(', ') || 'vars',
          error: `expected var ${key}=${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
          captures: {},
        };
      }
      details.push(`vars.${key}=${JSON.stringify(want)}`);
    }
  }

  if (hasHttpExpect) {
    const last = ctx.lastResponse;
    if (!last) {
      return {
        ok: false,
        detail: details.join(', ') || 'assert',
        error: 'no previous HTTP response to assert against',
        captures: {},
      };
    }

    if (expect.status != null) {
      const want = Number(interpolate(expect.status, ctx));
      if (last.status !== want) {
        return {
          ok: false,
          detail: `status ${last.status}`,
          error: `expected status ${want}, got ${last.status}`,
          captures: {},
        };
      }
      details.push(`status=${want}`);
    }

    if (expect.json && typeof expect.json === 'object') {
      const expected = interpolate(expect.json, ctx);
      for (const [key, want] of Object.entries(expected)) {
        const path = key.startsWith('$.') ? key : `$.${key}`;
        const got = getJsonPath(last.json, path);
        if (!deepEqual(got, want)) {
          return {
            ok: false,
            detail: details.join(', ') || 'json',
            error: `expected ${path}=${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
            captures: {},
          };
        }
        details.push(`${path}=${JSON.stringify(want)}`);
      }
    }

    if (expect.equals !== undefined) {
      const want = interpolate(expect.equals, ctx);
      const path = expect.path ? String(interpolate(expect.path, ctx)) : '$';
      const got = getJsonPath(last.json, path);
      if (!deepEqual(got, want)) {
        return {
          ok: false,
          detail: details.join(', ') || 'equals',
          error: `expected ${path}=${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
          captures: {},
        };
      }
      details.push(`${path} equals`);
    }
  }

  return {
    ok: true,
    detail: details.join(', ') || 'ok',
    error: null,
    captures: {},
  };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}
