# Flowbook

**FR** — Playbooks YAML versionnés de parcours métier (auth, paiement, accès premium), pas des dumps E2E fragiles. Steps `http`, `assert`, et désormais `browser` (Playwright).

**EN** — Versioned YAML playbooks of business journeys for web apps (auth + payment MVP), not fragile E2E dumps. Step types: `http`, `assert`, and `browser` (Playwright).

MVP focus: **signup → email verify → Stripe test checkout → assert premium access** (API *or* UI).

Repo: [WhoIsLoH/flowbook](https://github.com/WhoIsLoH/flowbook)

Site: [whoisloh.github.io/flowbook](https://whoisloh.github.io/flowbook/)

---

## Install / npx

Published package name: **`flowbook-cli`** (the short name `flowbook` is already taken on npm by an unrelated project; `@whoisloh/flowbook` is also free if you prefer a scoped name later).

```bash
# one-shot (no global install)
npx flowbook-cli validate path/to/playbook.yaml
npx flowbook-cli run path/to/playbook.yaml

# or install globally / as a dep — the binary is still named `flowbook`
npm install -g flowbook-cli
flowbook validate path/to/playbook.yaml
flowbook run path/to/playbook.yaml
```

**Browser steps:** Playwright does **not** download Chromium on install (too heavy for a postinstall). After install, run once:

```bash
npx playwright install chromium
```

---

## Quick start (from this repo)

```bash
# install CLI deps
npm install
npx playwright install chromium   # once, for browser steps

# install + start the demo app (port 3847)
npm install --prefix examples/demo-app
npm run demo
```

In another terminal:

```bash
# validate playbook shape
npm run validate:all
# or: npx flowbook validate playbooks/auth-signup-checkout.yaml

# run the HTTP journey against the local demo
npm run flowbook:http

# run the browser (UI) journey headless
npm run flowbook:browser

# watch the browser (headed)
FLOWBOOK_HEADED=1 npm run flowbook:browser

# sign up over the API, then check out in the browser already logged in
npm run flowbook:session
npm run flowbook:session-headers
```

Override the target:

```bash
BASE_URL=http://127.0.0.1:3847 npx flowbook run playbooks/auth-signup-checkout.yaml
# or
npx flowbook run playbooks/auth-signup-checkout.yaml --base-url http://127.0.0.1:3847
```

---

## Playbook YAML shape

```yaml
name: auth-signup-checkout
baseUrl: ${BASE_URL:-http://127.0.0.1:3847}
vars:
  email: demo+${TIMESTAMP}@example.com
  password: secret123
steps:
  - id: signup
    type: http
    method: POST
    path: /signup
    body: { email: ${email}, password: ${password} }
    capture:
      verifyToken: $.verifyToken
  - id: verify
    type: http
    method: POST
    path: /verify
    body: { token: ${verifyToken} }
  - id: checkout
    type: http
    method: POST
    path: /checkout
    headers: { Authorization: Bearer ${sessionToken} }
  - id: assert-premium
    type: assert
    http:
      method: GET
      path: /me
    expect:
      status: 200
      json:
        plan: premium
```

### Interpolation

- `${var}` — from playbook `vars`, prior `capture`s, or environment
- `${VAR:-default}` — env / var with default
- Built-ins: `${TIMESTAMP}`, `${UUID}`
- Capture paths (HTTP): `$.field` / `$.a.b[0]` (simple JSONPath)

### Step types

| Type | Role |
|------|------|
| `http` | Request (`method`, `path`, optional `headers` / `body` / `expect.status` / `capture`) |
| `assert` | Check `expect.status` / `expect.json` / `expect.equals` against last response (or nested `http:`), or `expect.vars` against captured playbook vars |
| `browser` | Drive a Chromium UI with Playwright (`actions`: `goto` / `fill` / `click` / `waitFor` / `capture`; optional `session` to start logged in) |

---

## Browser step

**FR** — Un step `browser` lance Chromium (headless par défaut) et enchaîne des actions UI. Utile pour les parcours où l’API seule ne suffit pas.

**EN** — A `browser` step launches Chromium (headless by default) and runs a sequence of UI actions.

```yaml
- id: ui-journey
  type: browser
  # headed: true          # optional; or FLOWBOOK_HEADED=1 / top-level playbook headed: true
  actions:
    - goto: /                    # relative to baseUrl, or absolute URL
    - fill:
        selector: '#email'
        value: ${email}
    - click: '#signup-btn'       # or { selector: '#signup-btn' }
    - waitFor: '#verify-token'   # selector string
    - waitFor: { url: '**/account' }
    - capture:
        verifyToken:
          selector: '#verify-token'
          attr: data-verify-token   # or omit for textContent; value: true for inputs
        plan:
          selector: '#account-plan'
          regex: '(premium|free)'   # optional extract from text
          group: 1
```

| Action | Fields |
|--------|--------|
| `goto` | URL path or absolute URL |
| `fill` | `selector`, `value` (interpolated) |
| `click` | selector string or `{ selector }` |
| `waitFor` | selector string, `{ selector }`, or `{ url }` (Playwright URL pattern) |
| `capture` | map of var → `{ selector, attr?, value?, regex?, group? }` or shorthand selector string |

Browser contexts are reused across consecutive `browser` steps in one run, then closed.

### Starting logged in: `session`

**FR** — Un step `browser` peut démarrer avec une session déjà authentifiée, à partir d’un token capturé par un step `http` (cookie, en-tête, localStorage). Pas besoin de repasser par le formulaire de login.

**EN** — A `browser` step can start with an authenticated session built from vars captured by earlier `http` steps, so the UI opens already logged in.

```yaml
- id: signup
  type: http
  method: POST
  path: /signup
  body: { email: ${email}, password: ${password} }
  capture:
    sessionToken: $.sessionToken

- id: checkout
  type: browser
  session:
    cookies:
      - name: session
        value: ${sessionToken}      # url defaults to baseUrl
    headers:
      Authorization: Bearer ${sessionToken}
    localStorage:
      authToken: ${sessionToken}
  actions:
    - goto: /checkout
```

| Key | What it does |
|-----|--------------|
| `cookies` | List of `{ name, value, url?, domain?, path?, expires?, httpOnly?, secure?, sameSite? }`. Without `url` or `domain`, the cookie is set for `baseUrl`. |
| `headers` | Extra request headers, sent only to requests on the `baseUrl` origin (not to CDNs or third parties). A `null` or empty value removes a header set by an earlier step. |
| `localStorage` | Key/value pairs written for the `baseUrl` origin before the page’s own scripts run on the next navigation (once per tab, so the app can still change or clear them). |

Notes:

- The session is applied to the shared browser context before the step’s actions run, and stays there for later `browser` steps in the same run. Cookies and headers from a later step are added on top (same name overwrites).
- Cookies follow normal browser rules: they are scoped by host, not port, so a cookie for `127.0.0.1:3847` is also sent to other ports on `127.0.0.1`.
- A cookie whose value resolves to an empty string fails the step, which usually means the var was never captured.
- `localStorage` takes effect on the next `goto`. If the page is already on the `baseUrl` origin, it is also written right away, but the page will not re-render by itself.

See `playbooks/api-signup-browser-checkout.yaml` (cookie) and `playbooks/api-signup-browser-headers.yaml` (header + localStorage).

---

## Layout

```
flowbook/
  src/cli.js              # flowbook run | validate
  src/runner.js           # sequential runner + report
  src/steps/http.js
  src/steps/assert.js
  src/steps/browser.js    # Playwright UI steps
  playbooks/auth-signup-checkout.yaml
  playbooks/auth-signup-checkout-browser.yaml
  playbooks/api-signup-browser-checkout.yaml   # API signup → browser checkout (session cookie)
  playbooks/api-signup-browser-headers.yaml    # same, with Authorization header + localStorage
  examples/demo-app/      # Express stub on :3847 (API + HTML UI)
```

## Demo app

### JSON API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/signup` | `{email,password}` → user pending + `verifyToken` + `sessionToken` |
| POST | `/verify` | `{token}` → verified |
| POST | `/checkout` | Bearer auth → mock Stripe → `plan: premium` |
| GET | `/me` | Bearer auth → `{email, verified, plan}` |

### HTML UI (same in-memory store)

| Path | Description |
|------|-------------|
| `GET /` | Signup form |
| `POST /ui/signup` | Creates user, shows verify token |
| `GET /verify` | Token form |
| `POST /ui/verify` | Verifies → redirect `/checkout` |
| `GET /checkout` | Mock pay button (session cookie or `Authorization: Bearer <sessionToken>`) |
| `POST /ui/checkout` | Sets `plan: premium` → `/account` |
| `GET /account` | Shows email / verified / plan, plus `localStorage.demo_note` if set |

In-memory only — no database, no real Stripe keys.

## License

MIT
