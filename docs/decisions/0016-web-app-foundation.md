# 0016. Web app foundation: auth, organizations and brands, real-stack e2e

- Status: Accepted
- Date: 2026-10-12
- Builds on: [0005](0005-linting-and-boundaries.md), [0008](0008-ui-styling-and-theme-generation.md), [0010](0010-real-browser-testing.md), [0013](0013-auth-sessions-and-http-layer.md), [0014](0014-brands-and-draft-tokens.md), [0015](0015-releases-and-public-api.md)

## Context

`apps/web` was a Vite placeholder. Phase 4a builds its foundation: sign up, sign in, sign out, the organization list and create, the brand list and create, and a placeholder brand page ("Token editor coming in 4b"), all from `@dts/ui`. The API (ADR 0013 to 0015) is complete through releases, and it was designed for a browser app served from **one origin that proxies `/api`**: a `SameSite=Lax` HttpOnly cookie, an `Origin` allowlist as the CSRF defense, **no CORS**. This phase is the first real client of those decisions, so the main risks are (a) getting the same-origin story wrong, (b) leaking one person's data to the next in the same tab, (c) an open redirect through `?next=`, (d) server text turning into markup, and (e) tests that pass while the real stack is broken (jsdom cannot see a broken proxy, a revoked session or real pixel contrast).

## Decision

### Same-origin through a proxy, not CORS

The browser only ever requests its own origin. In development and in the e2e suite `vite.config.ts` proxies `/api` to the API (`changeOrigin` stays false, so the browser's `Origin` reaches the API's CSRF check untouched; `ALLOWED_ORIGINS` must therefore contain `http://localhost:5173`, see `.env.example`). `vite preview` inherits the same proxy, which is how the e2e suite serves the **built** bundle with **the same proxy behavior**. In production the host will rewrite `/api/*` to the API (Phase 6, the verification list in ADR 0013 applies: `Origin` and `Set-Cookie` through the rewrite, `__Host-` cookie, `TRUST_PROXY`). `API_PROXY_TARGET` is read only in `vite.config.ts`; nothing in the API changes with the environment. `strictPort` is on for 5173/4173: silently moving to another port would turn every write into a confusing 403.

### React Router (declarative) and TanStack Query

`react-router` 8 in declarative mode (`BrowserRouter`, `Routes`) and `@tanstack/react-query` 5 own routing and server state. No data router or loaders: all fetching is in one place (queries), the router stays injectable (`MemoryRouter` in tests). Queries retry once for a network failure or a 5xx and **never on a 4xx**; mutations never retry (a create sent twice is a duplicate); no refetch on window focus (a tab regaining focus must not fire requests that end in a surprise redirect).

Routes: `/login`, `/signup`, `/` (organizations), `/orgs/:orgId` (brands), `/orgs/:orgId/brands/:brandId` (placeholder), `*` (404). `RequireAuth` asks `/api/me` once (the answer is shared through the cache with the header and the login page). **Nobody signed in** redirects to `/login?next=<page>` (replace). **The check itself failing** (network, 5xx) shows an error with a retry and does *not* redirect: sending someone to the login page because the Wi-Fi blinked would lose their place.

### The session lives in an HttpOnly cookie; the browser keeps nothing

No token, password, id or draft is written to `localStorage`, `sessionStorage`, IndexedDB or `document.cookie` (a unit-test source scan, a client test and an e2e test enforce it). The client sends `credentials: 'same-origin'`, no Authorization header. **One auth-expired signal**: a 401 from any endpoint except login, signup, logout and `/api/me` (where it is an ordinary answer) calls `handleAuthExpired` once: mark nobody signed in, **remove every cached query except `me`**, and let `RequireAuth` redirect with `next`. An explicit logout does the same after navigating to `/login` (so it does not also remember the page as `next`). The reason is privacy, not tidiness: otherwise user A's organizations and brands would sit in the query cache and could be shown to user B who signs in next in the same tab (tested with a real second user in e2e). The price is a refetch after signing in again.

### Return paths: `safeNext`

`next` is attacker-controlled (`/login?next=//evil.com`). Only a **same-origin path** is accepted: printable ASCII only; exactly one leading `/` (so never `//host` and never a scheme); no backslash anywhere; the **percent-decoded** form must pass the same rules (`/%2F%2Fevil.com`, `/%5Cevil.com`); at most 512 characters; not `/login` or `/signup` (a loop); and a final check with the URL parser that it stays on the same origin. Anything else is the fallback `/`. A hostile table of 40+ values, a 11,000-case generated check and an e2e test for five hostile values (asserting that no request leaves the origin) cover it.

### Server text is only ever React text

Server messages (a 400's sentence, an organization name) are rendered as React children, which escapes them. `describeApiError` passes server text through **only for a 400** (the API builds those from fixed sentences, plus a named `slug`/`name` field on the create forms). Every other message is the app's own: a proxy's HTML page or an unexpected body never reaches the screen, and an unknown error shows a generic message with the request id from `X-Request-Id`. ESLint forbids `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML` assignment, `insertAdjacentHTML` and `document.write` in `apps/web`; a second, independent source scan test does the same plus the browser-storage rule, and component and e2e tests render hostile names and messages and assert no element appears and no script runs.

### Forms

One hook (`useSubmitForm`) gives sign in, sign up, create organization and create brand the same behavior: client checks first (the same slug rule as the API through tokens-core's `isValidName` plus the **63-character cap**, a name of 1 to 200 characters after trimming, a 12 to 128 character password counted in code points); a failed submit shows a danger `Alert` (`role="alert"`, mounted in response to the submit) as an error summary whose links focus the fields, **moves keyboard focus to it**, and marks each field through `TextField error`; the API's answer is mapped back (409 on a create is a slug error, a 400 that names `slug` or `name` marks that field, the login 401 is **one** message whatever was wrong, a 429 says the retry time from `Retry-After`, a 503 asks to retry, an unknown error is generic with the request id). A pending form disables its button and ignores a second submit even if it arrives before React re-renders. Editing a field clears its error. The slug is suggested from the name (`Café Münch` to `cafe-munch`) until the person edits it.

The API gained `details.field` on the slug/name 400s of organization and brand creation for this (ADR 0014 amendment). Other 400s (sign-up email/password) stay form-level because zod errors carry no field names; client validation prevents most of them.

### Accessibility

One `h1` per page (`PageHeading`); `document.title` per route; after an in-app navigation **focus moves to the new `h1`** and a polite `role="status"` live region (mounted from the start and empty, so changing its text is announced) says where the person is; the first load of the app does not steal focus. A skip link is the first tab stop and `<main id="main">` is its target. Everything works by keyboard. Links in content are **underlined (not color alone)**, keep a visible `:focus-visible` outline and have a forced-colors rule. Not covered: screen readers, hover states, forced-colors and reduced-motion runs on these pages.

### Styling and `@dts/ui`

The app is wrapped in `<ThemeScope theme="default">` and built from `Button`, `TextField` and `Alert`. Its own CSS follows the `packages/ui` rules (only `--semantic-*`/`--component-*` variables, no raw colors, no primitives, no `var()` fallbacks, every variable defined in every theme), enforced by a **copy** of the scanner in `apps/web/test/support/cssRules.ts` with its own bad-sample self-tests. It is a copy, not a shared module, because the original lives in ui's test folder outside its `exports` and importing it by relative path would cross the package boundaries ESLint guards (ADR 0005). No new design tokens were added: the theme has no heading-size or wide-spacing token, so type scale and page width are `rem`/`em`/`ch` lengths (not colors, which the rules do not cover). `Dialog` is not used: create forms are inline on their list pages (fewer focus edge cases; easy to switch later).

### Hand-written API types

`src/api/types.ts` and `endpoints.ts` are written by hand from the route handlers. A shared contracts package (zod schemas used by both sides) was the alternative. **Drift risk:** the server changes a field and these types do not; TypeScript would not notice. It is mitigated by the real-stack e2e suite (any change that breaks a screen fails there) and by the endpoint tests that pin method, path and body of every call, and it is accepted because the API surface the web uses is nine calls.

### Real-stack end-to-end tests

`apps/web/e2e` runs Chromium against **the built bundle** (`vite preview`, with the dev proxy) in front of **the real API** against **a real Postgres**.

- **A test-only server entry**, `apps/api/test/support/e2eServer.ts`, run with `tsx` outside Vitest. It builds the app with the same helper the API tests use (`authApp`: real routes, repositories and middleware), with fast scrypt, rate limits injected so high no test hits them (the limiters are tested in `test/auth/rateLimit.test.ts`, including `Retry-After` on every 429) and the web origin as the only allowed `Origin`. **There is no environment switch in production code.** Order of its safety checks: the database name must end in `_test`, **the port must be free** (it exits with a clear error otherwise), and only then it creates and migrates the database and listens. It uses its own database, `dts_e2e_test`, so it never shares tables with the API suite. It imports nothing from Vitest (`truncateAll` moved to a Vitest-free file; a test walks the import graph) and logs `error` and above to stderr, so a long-running server collects nothing in memory.
- **Dedicated ports (3100 and 4173) and `reuseExistingServer: false`, always.** The suite can never attach to a developer's API (which could be writing to a development database).
- **Stale bundles cannot be tested:** `pnpm test:e2e` first runs `scripts/assertFreshDist.ts`, which fails if `dist/index.html` is missing or any source (`src`, `public`, `index.html`, `package.json`, `vite.config.ts`, and the sources of `@dts/ui` and `@dts/tokens-core`) is newer. `test:e2e:build` rebuilds first. CI uses the latter, because `generate:theme` rewrites a workspace file after `pnpm build`.
- `retries: 0` and `workers: 2` set explicitly (the default worker count flaked the Storybook suite on the 4-core development machine, ADR 0010); no sleeps. Two workers share one API and one database; every test creates its own user and slugs.
- **Scenarios (43 tests):** sign up lands on the organization list; log out and log in; a wrong password and an unknown email give the *same* message; an unauthenticated deep link goes to `/login?next=` and returns after sign-in; five hostile `next` values are ignored and no request leaves the origin; keyboard-only sign-up to create-organization (skip link first, focus on the heading); duplicate organization and brand slugs are slug-field errors; the 63/64 slug boundary; create brand and the placeholder page; another person's organization and brand look exactly like a missing one; markup in names is text; axe (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, including real contrast, with a check that contrast was really measured) on login, signup, organization list, brand list, brand page, not-found and four error states; link underline and focus outline; titles and focus after navigation; the cookie is `HttpOnly`, `SameSite=Lax`, not `Secure`, host-only, unreadable by script; browser storage stays empty; the browser only talks to its own origin and the API sends no CORS headers; **real session invalidation** (below); logout clears cached data for the next person in the tab.
- **Session invalidation, end to end.** A user signs up and sees their organization. `POST /api/auth/logout-all` is sent with the *same cookie* from a separate request context, so the browser still holds a cookie that is cryptographically valid but revoked (the session version, ADR 0013). The next action in the app (opening the organization) gets a 401 from the server; the app lands on `/login?next=…`, shows nothing of the old session (also after Back), and signing in again returns to the wanted page with data fetched afresh.

### Tests first, and proof that they can fail

Every test was written before its code and run red:

| Step | Red result |
|---|---|
| API slug cap, `details.field`, public cap | 12 tests failed + 1 suite (missing module) |
| web pure logic (`safeNext`, slug, validation, client, endpoints, error mapping, freshness guard) | 7 suites failed (missing modules) + 3 tests |
| component tests | 5 suites failed (no app) |
| e2e entry safety tests | 5 of 6 failed |
| web e2e against the placeholder | 43 tests: 42 failed, 1 passed (the premise check) |

Mutations (each applied to the real code, tests run, file restored with its sha256 verified, all strictly sequential):

| Mutation | web unit | web e2e |
|---|---|---|
| `isSafeNext` accepts anything starting with `/` (so `//evil.com`) | 37 fail | 3 fail |
| `RequireAuth` no longer redirects visitors without a session | 3 fail | 3 fail |
| the login email field loses its label | 19 fail (jest-axe `label`) | 13 fail (both axe specs: `[label]` critical) |
| the proxy path broken (`/api` to `/apix`) | **0 fail** (jsdom cannot see it) | 35 fail, 8 pass |
| a server message rendered through `dangerouslySetInnerHTML` | 2 fail (source scan, inert-text test) | n/a; **ESLint reports 1 error** |

### Finding: a CI-only e2e failure that looked like lost form input (it was a test race)

**Symptom (GitHub Actions only).** In `session.spec.ts` "logging out clears what was cached", after the second person filled Email and Password and clicked "Create account", the page still showed the sign-up form with "Enter your email address.", Email empty and Password filled.

**First hypothesis, refuted.** The form is unmounted or reset when the `/api/me` check resolves. Reading `GuestOnly`, `RequireAuth`, `useMe` and the router: the only branch that renders something other than the form is `GuestOnly`'s `me.isPending` branch, which renders *no form at all*, so nothing can be typed into it and nothing is lost when it resolves. After a logout `me` is set to `null` (fresh for five minutes), so the in-app link from `/login` to `/signup` makes no `/api/me` request (measured: 0). Two scratch Playwright specs (not kept) delayed `GET /api/me` by 1 s and filled Email right away on `/signup` and on `/login`: both **passed** (the field waits for the form to exist; the value survived the response).

**Actual cause.** `BrowserRouter` commits every navigation inside `React.startTransition` (React Router 8.4.0, `useTransitions` unset). After the click on "create an account" the URL is already `/signup`, but until React commits, the *login* form (same labels: "Email", "Password") is still in the DOM and still accepts input. The test clicked the link and filled at once, so on a slow runner (cold JIT, a render longer than one 5 ms time slice, two workers plus the API, vite and Postgres on 2 cores) the email went into the old login form and was dropped at the commit, while the password went into the new sign-up form. That is exactly the snapshot. It was the only place in the e2e suite that typed straight after a link click; every other click is followed by an assertion on the new page.

**Reproduced deterministically** (scratch spec, an init script that delays every React scheduler task by 300 ms once the login page is up): the original sequence fails with `#signup-email` empty (expected the typed address); the same sequence with a wait for the "Create an account" heading between the click and the first fill passes under the same lag. CPU throttling at 40x did *not* reproduce it, so the lag injection is what proved the mechanism; no trace from the failed CI run was available (the `gh` CLI was not authenticated), so the match rests on the snapshot plus the reproduction, not on a CI trace.

**Fix.** No app change. The test now waits for the "Create an account" heading before it types, like every other navigation in the suite. No retry, sleep, timeout or assertion was changed or weakened.

**Honest limits.**
- The cause is inferred from the snapshot and a reproduction of the same symptom; it is not proven for the one CI run.
- A real person cannot realistically type in the few milliseconds between a click and the commit; the app was not changed. If it ever matters, `useTransitions={false}` on `BrowserRouter` would commit navigations synchronously, at the cost of the transition behavior for every route; that was not judged worth it for a test race.
- Nothing prevents the same race in a future test. The convention is in the e2e rules in CLAUDE.md: after a click that navigates, assert on the new page before filling.

## Alternatives considered

- **CORS and a separate API origin.** Simpler to start, but it means a cross-site cookie (`SameSite=None; Secure`), a preflight surface and a wider CSRF story. ADR 0013 chose same-origin on purpose.
- **Tokens in `localStorage`** (or an `Authorization` header). Readable by any script, so one XSS is an account takeover; the HttpOnly cookie is not.
- **A data router with loaders and actions.** Fewer lines for some screens, but it splits fetching between two systems and makes the router harder to inject in tests.
- **SWR, Redux Toolkit Query, plain `useEffect`.** TanStack Query gives caching, dedupe, cancellation and mutation state with the retry rules above; hand-rolling those is where stale-data and double-submit bugs come from.
- **MSW for the unit tests.** Fetch is injected at one boundary instead, which is simpler, needs no service-worker or interceptor setup and cannot drift from a handler registry. The real-stack suite covers what a mock cannot.
- **A shared contracts package** (zod schemas for both sides). The right answer if the API surface the web uses grows; see the drift risk above.
- **`Dialog` for the create forms.** More compact lists, but a modal needs focus return and `inert` handling that jsdom cannot test; inline forms are keyboard-friendly and testable.
- **`vite preview` versus `sirv` or a small Express server for the e2e web server.** `sirv` cannot proxy and a hand-written proxy would be a second implementation that could pass while the real one is broken; `vite preview` serves the built bundle with the very proxy configuration under test.
- **Running the e2e against the Vite dev server.** Faster feedback, but it tests an unbundled development build; the bundle is what ships.
- **Reusing `dts_test` for the web e2e.** The API suite truncates every table between tests; two suites in one database would corrupt each other. A separate `*_test` database costs nothing.
- **Sharing the CSS scanner.** See Styling.

## Consequences and honest gaps

- **No idle-session handling beyond the 401 signal.** A tab left open for days finds out on its next request; there is no countdown or silent refresh (sessions are a fixed 7 days, ADR 0013). `me` is cached for five minutes, so the header can show an email for up to that long after a revocation.
- **No real-time collaboration, pagination or list virtualization.** Lists are bounded by what one person creates by hand; the API itself has no pagination yet for brands (ADR 0014).
- **English only**, like `@dts/ui`; the built-in strings are not translated.
- **Chromium only; no screen reader, no hover or active states, no forced-colors or reduced-motion runs on the web pages**; jsdom axe cannot judge contrast (the browser axe does, per page visited only).
- **The Viewer experience is tested in jsdom only.** There are no invitations or member endpoints, so a second-role user cannot be created through the API in e2e.
- **The e2e API is a test double of the production wiring:** fast scrypt, development cookies (no `__Host-`/`Secure`), no proxy chain. It proves the HTTP contract and the browser behavior, not production hardening (Phase 6).
- **Hand-written types can drift** (see above).
- **Two e2e workers share one API.** Isolation relies on every test creating its own user and slugs; a future test that lists "everything" would need care.
- **A failed logout** leaves the person signed in and says so; a logout whose response is lost after the server cleared the cookie looks the same.
- **No brand or organization rename, visibility toggle, delete, release or token screen** (Phase 4b and later).
- **Deployment is untested:** hosting rewrites, `Origin` and `Set-Cookie` through them, and the public CSS from another origin remain the Phase 6 list in ADR 0013 and ADR 0015.
