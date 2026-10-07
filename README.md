# Flowbook

**FR** — Playbooks YAML versionnés de parcours métier (auth, paiement, accès premium), pas des dumps E2E fragiles. Steps `http`, `assert`, et désormais `browser` (Playwright).

**EN** — Versioned YAML playbooks of business journeys for web apps (auth + payment MVP), not fragile E2E dumps. Step types: `http`, `assert`, and `browser` (Playwright).

MVP focus: **signup → email verify → Stripe test checkout → assert premium access** (API *or* UI).

Repo: [WhoIsLoH/flowbook](https://github.com/WhoIsLoH/flowbook)

---

## Quick start

```bash
# install CLI deps (+ Playwright)
npm install
npx playwright install chromium   # once, for browser steps

# install + start the demo app (port 3847)
npm install --prefix examples/demo-app
npm run demo
```

In another terminal:

```bash
# validate playbook shape
npm run flowbook -- validate playbooks/auth-signup-checkout.yaml

# run the HTTP journey against the local demo
npm run flowbook -- run playbooks/auth-signup-checkout.yaml

# run the browser (UI) journey headless
npm run flowbook -- run playbooks/auth-signup-checkout-browser.yaml

# watch the browser (headed)
FLOWBOOK_HEADED=1 npm run flowbook -- run playbooks/auth-signup-checkout-browser.yaml
```

Or via the bin after `npm link` / `npx`:

```bash
npx flowbook run playbooks/auth-signup-checkout.yaml
```

Override the target:

```bash
BASE_URL=http://127.0.0.1:3847 npm run flowbook -- run playbooks/auth-signup-checkout.yaml
# or
npm run flowbook -- run playbooks/auth-signup-checkout.yaml --base-url http://127.0.0.1:3847
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
| `browser` | Drive a Chromium UI with Playwright (`actions`: `goto` / `fill` / `click` / `waitFor` / `capture`) |

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
| `GET /checkout` | Mock pay button (session cookie) |
| `POST /ui/checkout` | Sets `plan: premium` → `/account` |
| `GET /account` | Shows email / verified / plan |

In-memory only — no database, no real Stripe keys.

## License

MIT
