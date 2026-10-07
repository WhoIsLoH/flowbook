# Flowbook

**FR** — Playbooks YAML versionnés de parcours métier (auth, paiement, accès premium), pas des dumps E2E fragiles.

**EN** — Versioned YAML playbooks of business journeys for web apps (auth + payment MVP), not fragile E2E dumps.

MVP focus: **signup → email verify → Stripe test checkout → assert premium access**.

Repo: [WhoIsLoH/flowbook](https://github.com/WhoIsLoH/flowbook)

---

## Quick start

```bash
# install CLI deps
npm install

# install + start the demo app (port 3847)
npm install --prefix examples/demo-app
npm run demo
```

In another terminal:

```bash
# validate playbook shape
npm run flowbook -- validate playbooks/auth-signup-checkout.yaml

# run the journey against the local demo
npm run flowbook -- run playbooks/auth-signup-checkout.yaml
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
- Capture paths: `$.field` / `$.a.b[0]` (simple JSONPath)

### Step types

| Type | Role |
|------|------|
| `http` | Request (`method`, `path`, optional `headers` / `body` / `expect.status` / `capture`) |
| `assert` | Check `expect.status` / `expect.json` / `expect.equals` against last response (or nested `http:`) |

---

## Layout

```
flowbook/
  src/cli.js              # flowbook run | validate
  src/runner.js           # sequential runner + report
  src/steps/http.js
  src/steps/assert.js
  playbooks/auth-signup-checkout.yaml
  examples/demo-app/      # Express stub on :3847
```

## Demo app endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/signup` | `{email,password}` → user pending + `verifyToken` + `sessionToken` |
| POST | `/verify` | `{token}` → verified |
| POST | `/checkout` | Bearer auth → mock Stripe → `plan: premium` |
| GET | `/me` | Bearer auth → `{email, verified, plan}` |

In-memory only — no database, no real Stripe keys.

## License

MIT
