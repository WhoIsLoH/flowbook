# Changelog

## 0.2.0 - 2026-10-08

### Added

- `session` option on `browser` steps, so the browser can start logged in with a token captured by an earlier `http` step:
  - `cookies`: set through Playwright `addCookies`; `url` defaults to `baseUrl`.
  - `headers`: extra request headers, sent only to requests on the `baseUrl` origin. `null` or empty removes a header.
  - `localStorage`: written for the `baseUrl` origin before page scripts run on the next navigation.
- `validate` checks the shape of `session` blocks and accepts several files at once.
- Playbooks `api-signup-browser-checkout.yaml` (session cookie) and `api-signup-browser-headers.yaml` (Authorization header + localStorage), both run in CI.
- Demo app: UI pages also accept `Authorization: Bearer <sessionToken>`; `/account` shows `localStorage.demo_note`.

### Changed

- `flowbook --version` reads the version from `package.json`.
- `npm run validate:all` validates every bundled playbook (used by CI and `prepublishOnly`).

## 0.1.0

- First release: `http`, `assert` and `browser` (Playwright) steps, `run` and `validate` commands, demo app.
