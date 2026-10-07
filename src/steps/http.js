import { fetch } from 'undici';

/**
 * Execute an HTTP playbook step.
 * Supports method, path, headers, body, capture (JSON path → var name).
 */
export async function runHttpStep(step, ctx, interpolate, getJsonPath) {
  const method = String(interpolate(step.method || 'GET', ctx)).toUpperCase();
  const path = String(interpolate(step.path || '/', ctx));
  const url = path.startsWith('http') ? path : `${ctx.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

  const headers = {
    Accept: 'application/json',
    ...(interpolate(step.headers || {}, ctx) || {}),
  };

  let body;
  if (step.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = JSON.stringify(interpolate(step.body, ctx));
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  ctx.lastResponse = {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: json ?? text,
    json,
    text,
  };

  const captures = {};
  if (step.capture && typeof step.capture === 'object') {
    for (const [name, pathExpr] of Object.entries(step.capture)) {
      const resolvedPath = String(interpolate(pathExpr, ctx));
      const value = getJsonPath(json, resolvedPath);
      if (value === undefined) {
        return {
          ok: false,
          detail: `${method} ${path} → ${res.status}`,
          error: `capture ${name}: path ${resolvedPath} not found in response`,
          captures,
        };
      }
      captures[name] = value;
    }
  }

  const expectStatus = step.expect?.status;
  if (expectStatus != null && res.status !== Number(expectStatus)) {
    return {
      ok: false,
      detail: `${method} ${path} → ${res.status}`,
      error: `expected status ${expectStatus}, got ${res.status}`,
      captures,
    };
  }

  // Default: treat 2xx/3xx as success unless expect.status was set
  const ok = expectStatus != null ? true : res.status >= 200 && res.status < 400;

  return {
    ok,
    detail: `${method} ${path} → ${res.status}`,
    error: ok ? null : `unexpected status ${res.status}`,
    captures,
  };
}
