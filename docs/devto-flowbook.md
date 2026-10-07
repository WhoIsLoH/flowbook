---
title: "Flowbook: versioned YAML playbooks for the product journeys your tests and API docs both miss"
published: false
description: "Signup → verify → checkout → premium, written once as a readable YAML playbook and run over HTTP or a real browser. Open source, npx-ready."
tags: testing, opensource, playwright, devops
cover_image: ""
# Cover idea: a single YAML card titled "signup → verify → checkout → premium ✓" sitting between a messy Cypress log on the left and an OpenAPI spec on the right.
canonical_url: https://whoisloh.github.io/flowbook/
---

<!--
Suggested tags (Dev.to allows 4): testing, opensource, playwright, devops
Alternates: javascript, node, cli, stripe
Cover idea (one line): A clean YAML card "signup → verify → checkout → premium ✓" bridging a noisy Cypress log (left) and an OpenAPI spec (right).
-->

Most web apps have a handful of journeys that actually pay the bills: a user signs up, verifies their email, pays, and gets access to the premium thing. If one of those breaks, you hear about it from customers.

Yet when I look for where those journeys are *written down*, I usually find two things:

- **E2E test dumps** (Cypress, Playwright, recorded scripts) — they exercise the journey, but they're long, selector-heavy, and hard for anyone outside the test author to read or review.
- **API specs** (OpenAPI) — precise about each endpoint, but silent about the *order* things happen in and what "success" means for the business.

Neither one answers the simple question: *"What is our signup-to-paid flow, step by step, and does it still work?"*

That's the gap **Flowbook** tries to fill.

## What Flowbook is

Flowbook is a small open-source CLI that runs **versioned YAML playbooks of business journeys**. A playbook is a short, reviewable file in your repo that describes a flow as a sequence of steps:

- `http` — make a request, check the status, capture values from the response
- `assert` — check status / JSON / captured variables
- `browser` — drive Chromium via Playwright (`goto`, `fill`, `click`, `waitFor`, `capture`)

The idea is that the playbook is the shared artifact: product, backend and QA can all read it in a PR, and CI can run it.

The MVP focuses on one journey that almost every SaaS has: **signup → email verify → checkout (Stripe-style test payment) → assert premium access**, either via the API or through the UI.

## Install

The npm package is `flowbook-cli`; the binary it installs is `flowbook`. Node 18+.

```bash
# one-shot, no global install
npx flowbook-cli validate path/to/playbook.yaml
npx flowbook-cli run path/to/playbook.yaml

# or install it — the command is `flowbook`
npm install -g flowbook-cli
flowbook run path/to/playbook.yaml
```

If you use `browser` steps, install Chromium once (it's not downloaded on install, to keep the package light):

```bash
npx playwright install chromium
```

## A playbook, end to end (HTTP)

Here's the HTTP version of the MVP journey, trimmed slightly from the repo:

```yaml
name: auth-signup-checkout
description: Signup → email verify → mock Stripe checkout → assert premium access
baseUrl: ${BASE_URL:-http://127.0.0.1:3847}
vars:
  email: demo+${TIMESTAMP}@example.com
  password: secret123
steps:
  - id: signup
    type: http
    method: POST
    path: /signup
    body:
      email: ${email}
      password: ${password}
    expect:
      status: 201
    capture:
      verifyToken: $.verifyToken
      sessionToken: $.sessionToken

  - id: verify
    type: http
    method: POST
    path: /verify
    body:
      token: ${verifyToken}
    expect:
      status: 200

  - id: checkout
    type: http
    method: POST
    path: /checkout
    headers:
      Authorization: Bearer ${sessionToken}
    expect:
      status: 200

  - id: assert-premium
    type: assert
    http:
      method: GET
      path: /me
      headers:
        Authorization: Bearer ${sessionToken}
    expect:
      status: 200
      json:
        plan: premium
```

A few things worth noting:

- `${var}` pulls from `vars`, earlier `capture`s, or environment variables; `${VAR:-default}` gives a fallback.
- `${TIMESTAMP}` and `${UUID}` are built in, so every run gets a fresh user.
- `capture` uses simple JSONPath (`$.field`, `$.a.b[0]`) to carry tokens forward.

You can point the same file at another environment without editing it:

```bash
BASE_URL=https://staging.example.com npx flowbook-cli run playbooks/auth-signup-checkout.yaml
# or
npx flowbook-cli run playbooks/auth-signup-checkout.yaml --base-url https://staging.example.com
```

## The same journey through the UI

Some flows can't be trusted from the API alone — the button might be broken even if the endpoint works. A `browser` step runs the journey in headless Chromium:

```yaml
steps:
  - id: ui-journey
    type: browser
    actions:
      - goto: /
      - fill: { selector: '#email', value: ${email} }
      - fill: { selector: '#password', value: ${password} }
      - click: '#signup-btn'
      - waitFor: '#verify-token'
      - capture:
          verifyToken: { selector: '#verify-token', attr: data-verify-token }
      - goto: /verify
      - fill: { selector: '#token', value: ${verifyToken} }
      - click: '#verify-btn'
      - waitFor: { url: '**/checkout' }
      - click: '#checkout-btn'
      - waitFor: { url: '**/account' }
      - capture:
          plan: { selector: '#account-plan', attr: data-plan }

  - id: assert-premium-plan
    type: assert
    expect:
      vars:
        plan: premium
```

Set `FLOWBOOK_HEADED=1` (or `headed: true`) to watch it run.

## Try it locally in two minutes

The repo ships a tiny Express demo app (in-memory, no database, no real Stripe keys — checkout is mocked) so you can see a full run:

```bash
git clone https://github.com/WhoIsLoH/flowbook && cd flowbook
npm install && npx playwright install chromium
npm install --prefix examples/demo-app
npm run demo            # starts the demo app on :3847

# in another terminal
npm run flowbook:http
npm run flowbook:browser
```

Both playbooks are validated and run in GitHub Actions on every push, and CI is green.

If you'd rather not install anything yet, there's an interactive demo in the browser: https://whoisloh.github.io/flowbook/demo.html

## Where it fits (and where it doesn't)

Flowbook is **not** a replacement for your unit tests or your full E2E suite. Think of it as:

- a **living spec** for the 3–10 journeys that matter most to the business,
- a **smoke check** you can run against local, staging, or a preview deploy,
- a place to encode **payment test flows** (e.g. a Stripe test-mode checkout) as steps someone can actually read in review.

It's an early `0.1.0`. Right now that means sequential steps, `http` / `assert` / `browser` step types, and one reference journey. I'd love feedback on what the next step types or journeys should be — real Stripe test-mode examples, magic-link email verification, team invites, plan downgrades…

## Links

- GitHub: https://github.com/WhoIsLoH/flowbook
- npm: https://www.npmjs.com/package/flowbook-cli (`npx flowbook-cli`)
- Landing page: https://whoisloh.github.io/flowbook/
- Interactive demo: https://whoisloh.github.io/flowbook/demo.html

Issues and PRs welcome. If you have a journey that keeps breaking in your app, open an issue describing it — that's exactly the kind of playbook I want to support.

---

**🇫🇷 Petite note en français :** Flowbook décrit vos parcours métier clés (inscription → vérification email → paiement → accès premium) en playbooks YAML versionnés, exécutables en HTTP ou dans un vrai navigateur (Playwright). Essayez `npx flowbook-cli` — retours bienvenus sur GitHub.
