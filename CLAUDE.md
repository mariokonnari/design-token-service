# design-token-service

A multi-tenant Design Token & Theming service. Teams log in, manage their brand's design tokens (color, spacing, typography), preview them live against an accessible React component library, and export them as CSS variables or JSON.

> Status: scaffolded pnpm monorepo with ESLint + Prettier (import-boundary rules), a built-output API smoke test and GitHub Actions CI. `apps/api` and `apps/web` are no longer placeholders: see the paragraphs below (the API through ADR 0015, the web app foundation in ADR 0016).
> `packages/ui` now has a foundation (ADR 0008): themes generated from `tokens/*.tokens.json` into the committed `src/themes.generated.css` (`pnpm generate:theme`, drift-checked in CI), `ThemeScope`, accessible `Button`, `TextField`, `Checkbox` and `Alert` (ADR 0009), `Tabs` (compound, roving tabindex) and a native-`<dialog>` `Dialog` (ADR 0011), tests that enforce the styling rules (no primitives, no raw colors, no `var()` fallbacks, every variable defined in every theme, forced-colors/focus/reduced-motion structure) and a declarative contrast registry (`test/contrastPairs.ts`, checked for every theme), and Storybook with the a11y addon and a theme toggle (`pnpm --filter @dts/ui storybook`). Built-in text is English-only by default and overridable by props; the library ships no translations.
> Real-browser tests (ADR 0010): Playwright runs against the BUILT Storybook in Chromium (`pnpm test:e2e`, specs in `packages/ui/e2e/`): axe with WCAG 2.0 to 2.2 A/AA tags (including real-pixel text contrast), theming, keyboard focus rings, 24px target size, forced colors and reduced motion, for every story in both themes. Not covered: non-text contrast (the registry still owns it), screen readers, visual regression, other browsers. The story URL builder (`e2e/support/stories.ts`) turns off the a11y addon's automatic axe run with `globals=...;a11y.manual:!true` (it raced with ours on CI: "Axe is already running"); `harness.spec.ts` reads the global back, so keep that test green after a Storybook upgrade.
> `packages/tokens-core` now has the real token model: `flatten`/`nest`, literal validation, alias `resolve` with cycle detection, and `checkTiers` (ADR 0006), plus the exporters `toCssVariables` (scoped CSS custom properties, collision detection, escaping) and `toResolvedTree` (JSON), and sRGB color/contrast utilities (WCAG 2.x) (ADR 0007).
> `apps/api` now has a data foundation (ADR 0012): Postgres 17 in Docker (`pnpm db:up`), a Prisma 7 schema with committed migrations and hand-written CHECK constraints, zod-validated config that fails closed, `GET /health` (liveness, no DB) and `GET /ready` (DB query, 503 when unreachable), a real-Postgres test harness (a separate `*_test` database, serial test files, a guard that refuses any other database), and a repository skeleton (`TenantScope` + one policy module + a lint rule that keeps the Prisma client inside `src/db` and `src/repositories`). The API does not connect to the database at startup.
> `apps/api` now has accounts, sessions and organization membership (ADR 0013): scrypt passwords (concurrency-capped), an HS256 JWT in an HttpOnly cookie verified against the database (and its session version) on every request, a central error handler (`{ error: { code, message } }`), CSRF defenses (SameSite + an `Origin` allowlist + JSON-only, no CORS), strict zod bodies, rate limits, redacted pino logs, a **route table** (`src/routes/table.ts`) that is the only source of routes, `requireOrg` (the only caller of `issueTenantScope`, 404 across tenants) and member management with a last-owner invariant enforced by row locking. Routes: `/health`, `/ready`, `/api/auth/*`, `/api/me`, `/api/orgs`, `/api/orgs/:orgId/members[...]`.
> `apps/api` now has brands and draft tokens (ADR 0014): brands (create, list, read, rename; visibility is OWNER-only; slug immutable; **no delete in v1**), per-token draft CRUD with optimistic concurrency (`expectedVersion`) and a path-conflict rule, `draftRevision`, a read-only draft validation (`/validate`, pure `validateDraft` with an extensible rule list) and a replace-only bulk import (own 512 KB body limit, structure guard, per-user rate limit). **Every draft mutation runs in one transaction that locks the brand row (`SELECT ... FOR UPDATE`), changes the draft and bumps `draftRevision` by 1**, with `lock_timeout` < the transaction timeout (a held lock is a 503 `SERVICE_BUSY` + `Retry-After`, never a hang). Routes: `/api/orgs/:orgId/brands`, `/brands/:brandId`, `/brands/:brandId/tokens` (+ `/tree`, `/import`, `/:path`) and `/brands/:brandId/validate`.
> `apps/api` now has releases and public endpoints (ADR 0015): `POST .../brands/:brandId/releases` (EDITOR+) publishes under the **same brand-row lock** as every draft mutation (compare `expectedRevision` with the locked `draftRevision`, read the rows only after the lock, `validateDraft`, number under the lock; `NO_CHANGES` for an unchanged revision, `RELEASE_LIMIT` at 200 releases per brand), storing the source-tree snapshot, the CSS (`[data-theme="<brand slug>"]`, semantic + component tiers) and its sha256; `GET .../releases` (cursor pagination: `?before=&limit=`), `.../releases/:number` and `.../releases/:number/css` (strong ETag, 304) for VIEWER+; and two **unauthenticated** routes, `GET /api/public/orgs/:orgSlug/brands/:brandSlug/css|json`, that serve the latest release of a **PUBLIC** brand only, with one uniform 404 for everything else and, on these two routes only, `Cross-Origin-Resource-Policy: cross-origin` + `Access-Control-Allow-Origin: *` (60 s public cache, no `immutable`). `Release` rows are immutable (a database trigger, and the repository exposes no update or delete). `validateDraft` gained `NOTHING_TO_EXPORT` and `RELEASE_TOO_LARGE` (1 MiB of snapshot + CSS). Phase 3d also fixed two Phase 3c findings: a token created after a delete gets `version = the new draftRevision` (no ABA), and tokens-core `flatten` is no longer quadratic in nesting depth.
> `apps/web` now has the web app foundation (ADR 0016): sign up, sign in, sign out, organization list/create, brand list/create and a placeholder brand page, built from `@dts/ui` (`Button`, `TextField`, `Alert`; no `Dialog`) on React Router 8 (declarative) and TanStack Query 5. The browser only talks to its own origin: `/api` is proxied (Vite dev server and `vite preview`; production will use hosting rewrites, Phase 6), the session is the API's HttpOnly cookie and **the browser stores nothing** (no tokens in `localStorage`; a 401 anywhere is ONE signal that empties the query cache and sends the person to `/login?next=`). `?next=` goes through `safeNext` (same-origin printable-ASCII paths only). Server text is rendered only as React text (ESLint forbids `dangerouslySetInnerHTML` and friends in `apps/web`). Organization and brand **slugs are capped at 63 characters** (API, database CHECK, public routes, web). Tests: Vitest + Testing Library + jest-axe in jsdom (fetch injected, no MSW), and a **real-stack Playwright suite** (`apps/web/e2e`: Chromium -> the built bundle via `vite preview` -> the real API through the test-only entry `apps/api/test/support/e2eServer.ts` -> a real Postgres database `dts_e2e_test`; ports 3100/4173, `reuseExistingServer: false`, `retries: 0`, `workers: 2`; refuses a stale `dist/`).
> Not built yet: email verification, password reset, MFA, invitations, unpublish or purge of releases (a brand at its release cap is stuck), webhooks, a CDN purge, a release diff (the Phase 5 contrast gate would be one more `validateDraft` rule), brand delete, pagination of tokens and brands, an audit log, deployment (Supabase/Render, see ADR 0012 and the Phase 6 checks in ADR 0013, plus a cross-origin `<link rel=stylesheet>` check of the public CSS), Postgres row-level security, a least-privilege database role, any editor use of the exporters, components beyond `Button`, `TextField`, `Checkbox`, `Alert`, `Tabs` and `Dialog`, APCA. The layout below is the **target**; anything listed there beyond the above is still planned.

## Target layout

```
apps/
  web/            Vite + React + TypeScript — the Theme Editor (ADR 0016)
    src/api/      client.ts (the ONLY fetch wrapper: ApiError, the 401 signal), endpoints.ts, types.ts (hand-written)
    src/auth/     safeNext, me (session cache helpers), RequireAuth / GuestOnly
    src/forms/    slug, validation, describeError (server error -> field/form message), useSubmitForm
    src/components/ Shell, PageHeading (title + focus + announcement), Announcer, FormErrorSummary, NameSlugForm, QueryError
    src/pages/    Login, Signup, Orgs, Brands, Brand (placeholder), NotFound
    src/styles/   app.css (semantic variables only, same rules as ui)
    test/         Vitest: pure logic, pages on a fake fetch, CSS rules, source scan
    e2e/          Playwright against the built bundle + real API + Postgres
    scripts/      assertFreshDist (refuses a stale dist/)
  api/            Node + Express + TypeScript, Prisma, PostgreSQL, JWT auth
    prisma/       schema.prisma, committed migrations (CHECK constraints live in the SQL)
    src/config/   zod-validated environment (parseEnv)
    src/app.ts    createApp: the middleware stack (APP_MIDDLEWARE) + mounting the route table
    src/http/     request id, logger (redaction), Origin check, JSON-only check, error handler, rate limits
    src/auth/     password (scrypt), session (JWT cookie), authenticate, requireOrg
    src/routes/   table.ts (THE route table), mount.ts, validate.ts, and the handlers (auth, orgs, brands, tokens, health)
    src/db/       the ONLY place the Prisma client / adapter / pg may be imported (plus repositories); txTiming (lock/transaction timeouts), errors (busy -> 503)
    src/repositories/  data access: every function takes a TenantScope first (brands, memberships, tokens = the draft, releases)
    src/repositories/public/  the ONE unauthenticated read (the latest release of a PUBLIC brand): no TenantScope, read-only, `visibility: 'PUBLIC'` in every query
    src/tokens/   pure: mapper (row <-> tokens-core Token), validateWrite (limits), validateImport, treeGuard, validateDraft (rules), issueView
    src/releases/ pure: build (rows -> snapshot + CSS + sha256), limits (release size and count caps)
    src/tenancy/  TenantScope + issueTenantScope (auth middleware only) + policy.ts (roles)
    test/         DB tests (real Postgres), guard, convention test; support/e2eServer.ts = the TEST-ONLY server the web e2e starts
docker-compose.yml  local Postgres 17 on 127.0.0.1:5433
packages/
  tokens-core/    Pure TypeScript: DTCG-style token parsing, alias resolution
                  with cycle detection, validation, exporters
  ui/             Accessible React components consuming CSS custom properties;
                  Storybook, Testing Library + axe
    tokens/       default.tokens.json (complete base) and <slug>.tokens.json
                  overlays (e.g. acme), the source of the theme CSS
    scripts/      build-theme.ts and lib/ (token files -> themes.generated.css)
    src/          components, ThemeScope, committed themes.generated.css
    test/         enforcement tests (styling rules, contrast, drift)
    e2e/          Playwright specs against the built Storybook (real Chromium)
docs/
  decisions/      Architecture Decision Records (ADRs)
```

### Dependency direction

- `apps/web` -> `packages/ui`, `packages/tokens-core`
- `apps/api` -> `packages/tokens-core`
- `packages/tokens-core` -> nothing (pure logic: no Node, DOM, or React dependencies)
- `packages/ui` must **not** import `tokens-core` at runtime. Components only read CSS custom properties.
- `packages/ui` **may** depend on `tokens-core` as a devDependency / build step, to generate its default theme CSS from the token source so the default theme cannot drift from the tokens.

The two `ui`/`tokens-core` import boundaries above are enforced by ESLint (`no-restricted-imports`, see ADR 0005). Workspace packages are consumed as TypeScript source (ADR 0003), so `apps/api` bundles them with tsup.

Decisions: [0001 monorepo](docs/decisions/0001-monorepo-structure.md), [0002 tokens and theming](docs/decisions/0002-token-model-and-theming.md), [0003 package consumption](docs/decisions/0003-workspace-package-consumption.md), [0004 TypeScript 6 pin](docs/decisions/0004-typescript-6-pin.md), [0005 linting and boundaries](docs/decisions/0005-linting-and-boundaries.md), [0006 token subset and tier rules](docs/decisions/0006-token-subset-and-tier-rules.md), [0007 CSS export and contrast](docs/decisions/0007-css-export-and-contrast.md), [0008 UI styling and theme generation](docs/decisions/0008-ui-styling-and-theme-generation.md), [0009 form controls and alerts](docs/decisions/0009-form-controls-and-alerts.md), [0010 real-browser testing](docs/decisions/0010-real-browser-testing.md), [0011 tabs and dialog](docs/decisions/0011-tabs-and-dialog.md), [0012 data model and tenancy](docs/decisions/0012-data-model-and-tenancy.md), [0013 auth, sessions and the HTTP layer](docs/decisions/0013-auth-sessions-and-http-layer.md), [0014 brands and draft tokens](docs/decisions/0014-brands-and-draft-tokens.md), [0015 releases and the public API](docs/decisions/0015-releases-and-public-api.md), [0016 web app foundation](docs/decisions/0016-web-app-foundation.md).

## API and database

Needs Docker (Desktop) for the local database. First time: `cp apps/api/.env.example apps/api/.env`, then:

- `pnpm db:up` starts Postgres (waits for the healthcheck); `pnpm db:down` stops it; `pnpm db:reset` **deletes the local volume** after asking you to type `reset` (`--yes` skips the prompt; it refuses without a terminal otherwise) and re-applies the migrations.
- `pnpm db:migrate` applies the committed migrations (`prisma migrate deploy`); `pnpm db:migrate:dev` authors a new one (needs the `<db>_shadow` database, created on demand); `pnpm db:drift` fails if `schema.prisma` and the migrations disagree; `pnpm db:studio`; `pnpm db:generate` regenerates the client (`pnpm install` does it through `postinstall`; the generated client in `apps/api/src/generated` is not committed).
- `pnpm --filter api dev` runs the API with `--env-file=.env`; `start` loads no file. Required variables: `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET` (32+ characters, no default anywhere); optional `PORT`, `SIGNUP_ENABLED`, `ALLOWED_ORIGINS` (the only origins allowed to send POST/PATCH/DELETE), `TRUST_PROXY` (trusted proxy hops, default 0). A missing or invalid variable stops the app with one message listing all of them.
- Tests: `pnpm test` runs the API tests against `dts_test` (created and migrated by the global setup). They **refuse to run** unless `DATABASE_URL` names a database ending in `_test`, and they run files serially because they truncate every table between tests.
- Prisma is pinned to 7.x (npm's `latest` tag points at the 8 release candidate: install with `@7`). Prisma's own install scripts are explicitly ignored in `pnpm-workspace.yaml`; do not approve them without reading ADR 0012.
- CHECK constraints are only guarded by `apps/api/test/db/constraints.test.ts` (the drift check cannot see them). Add a test with every new one.
- **Adding a route (ADR 0013):** add it to the route table (`src/routes/table.ts`, through a module like `routes/orgs.ts`) with its `access`; never call `app.get/post/...` or `Router()` elsewhere (ESLint forbids it, and a guard test fails on any mounted route that is not in the table). Parse the body with a strict zod schema (`z.strictObject`) and validate path parameters (a malformed id is a 404). An org-scoped route (`access: { orgRole }`) MUST get a case in `test/orgs/leakMatrix.test.ts` (the test fails without it). A route narrowed by a policy function sets `refinedBy` and needs per-role tests. Throw typed errors from `src/errors.ts`; the central handler formats them. Every state-changing request needs an `Origin` from `ALLOWED_ORIGINS` and a JSON body, in tests too (`test/support/authApp.ts` has `post/patch/del` helpers).
- **Brand-scoped routes and draft mutations (ADR 0014):** a route under `/brands/:brandId` MUST get a case in `test/orgs/leakMatrix.test.ts` including the **wrong-parent** check (a member of two organizations asking for one organization's brand through the other's URL gets the same 404 as any miss; the test fails if a `:brandId` route has no case). Every draft mutation goes through `TokenRepository.mutate()` (lock the brand row, change, bump `draftRevision`); never write `Token` rows outside it. Tenant-checked SQL belongs in an **exported function that takes a `TenantScope` first** (`lockBrand`, `bumpRevision`): the convention test ignores private methods. Typed errors can carry `details` (sent as `error.details`, e.g. the issue list of a 400 or `currentVersion` of a 409; never on a cross-tenant 404). A route that needs a bigger body than the global 16 KB sets `bodyLimit` in the route table (its parser runs after authentication, the role check and `after` limiters; the test pins the list). Bound every client-supplied integer to its column type (int4: 2147483647) in the zod schema. Limits live in `tokens/validateWrite.ts` (`LIMITS`) and `tokens/treeGuard.ts`.
- **Releases and public routes (ADR 0015):** publishing goes through `ReleaseRepository.publish` only (lock the brand row first, read the draft after the lock, number under the lock); **never write an update or a delete of a `Release`** (the trigger refuses it and `test/repositories/releaseImmutability.test.ts` scans `src` for it; `ReleaseRepository`'s public methods are pinned to `get, getCss, list, publish`). A route with `:number` in its path needs the foreign-release-number cases in `test/orgs/leakMatrix.test.ts` (the `release: true` flag; the test fails without it). The trigger is invisible to `db:drift`; `test/db/releaseImmutable.test.ts` is its only guard. A **public** route (`access: 'public'` under `/api/public`) takes its repository from `src/repositories/public/` (checked by its own convention: no `TenantScope`, reads only, `visibility: 'PUBLIC'` in every query), validates slugs before any database access, puts `publicHeaders` and the per-IP limiter first in `before`, and answers every refusal with the same 404; the cross-origin headers must stay on these routes **only** (the Phase 3b "no CORS" tests prove the rest). The token `version` invariant (ADR 0014): a create gets the new `draftRevision`, an update adds 1, an import gives survivors `old + 1` and new paths the new revision.
- Never log or return a password, a hash or a token; the tests grep the logs and bodies for them. `TRUST_PROXY` must match the real number of proxies (ADR 0013).
- Repository rules (ADR 0012): every repository function takes a `TenantScope` first, calls `requireScope`, filters by `scope.organizationId` in every query and asks `tenancy/policy.ts` about roles. Only the auth middleware may import `issueTenantScope`. A cross-tenant read returns "not found", never 403.

## Web app (`apps/web`, ADR 0016)

- Dev: `cp apps/api/.env.example apps/api/.env`, `pnpm db:up`, then `pnpm dev` (API on :3000, web on :5173 with `/api` proxied). `ALLOWED_ORIGINS` must contain `http://localhost:5173` or every write is a 403. Production will serve the bundle behind hosting rewrites (Phase 6).
- Tests: `pnpm --filter web test` (Vitest, jsdom, fetch injected). Real-stack e2e: `pnpm test:e2e:web:build` (rebuilds the bundle first, then runs the suite); `pnpm test:e2e:web` runs against the existing `dist/` and **refuses to start if `dist/` is older than its sources**. It needs Docker Postgres up (`pnpm db:up`), Chromium installed (`pnpm --filter web exec playwright install chromium`), and ports **3100 and 4173 free**: it never reuses a running server and its API entry exits with an error if the port is taken. It creates its own database `dts_e2e_test` (derived from `DATABASE_URL`, or `E2E_DATABASE_URL`) and empties it on start.
- **All API calls go through `src/api/client.ts`** (same-origin `/api/...` paths only, `credentials: 'same-origin'`, normalized `ApiError`). Adding a call: a typed function in `endpoints.ts` (ids URL-encoded, body rebuilt from named fields), its type in `types.ts`, a case in `test/endpoints.test.ts`. A 401 is handled in ONE place (`onAuthExpired` -> `handleAuthExpired`); screens never handle it themselves.
- **Never store anything in the browser** (`localStorage`, `sessionStorage`, IndexedDB, `document.cookie`): `test/sourceRules.test.ts` fails on it. Anything that comes from the URL as a place to go goes through `safeNext`.
- **Server text is only rendered as React children.** ESLint forbids `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML` assignment, `insertAdjacentHTML` and `document.write` in `apps/web`; `describeApiError` decides which server sentences may be shown (a 400 only).
- Adding a page: a route in `App.tsx` (under `RequireAuth` if it needs a session), `PageHeading` for the single `h1` (it sets the title and moves focus after navigation), a case in `test/pages/accessibility.test.tsx` and in `e2e/accessibility.spec.ts`. Adding a form: `useSubmitForm` (error summary, focus, double-submit guard) and a case in `describeError.test.ts` for any new API error. Styling follows the `@dts/ui` rules (`test/cssRules.test.ts` scans `src/**/*.css`); links use `.link` (underlined, focus ring).
- A failing e2e test is a finding to fix in the app (or the test if it is wrong), never a reason to add retries or sleeps.

## Token architecture

Tokens are W3C DTCG-style JSON (`$value` / `$type`), a documented **subset** of spec 2025.10, not a conforming implementation (ADR 0006). Supported types: `color` (srgb only), `dimension`, `fontFamily`, `fontWeight`, `number`. Aliases reference other tokens with `{path.to.token}`. Path segments must match `^[a-z0-9]+(-[a-z0-9]+)*$` because they become CSS variable names.

Three tiers, as the top-level groups `primitive`, `semantic` and `component`:

1. **Primitive**: literal values only (`primitive.color.blue-500`).
2. **Semantic**: intent; may alias primitive or semantic tokens (`semantic.color.action` -> `{primitive.color.blue-500}`).
3. **Component**: component-specific; may alias semantic or component tokens (`component.button.background` -> `{semantic.color.action}`).

**UI components never reference primitive tokens; they use semantic and component tokens.** Semantic and component tokens may also hold literals (a policy that may tighten later).

```json
{
  "primitive": {
    "color": {
      "blue-500": {
        "$type": "color",
        "$value": { "colorSpace": "srgb", "components": [0.145, 0.388, 0.922] }
      }
    }
  },
  "semantic": {
    "color": { "action": { "$value": "{primitive.color.blue-500}" } }
  },
  "component": {
    "button": { "background": { "$value": "{semantic.color.action}" } }
  }
}
```

An alias token takes its type from its target. Problems are returned as issues (`{ code, severity, path, message, field?, related? }`), never thrown.

## Adding a component to `packages/ui`

1. Create `src/<Name>/` with `<Name>.tsx`, `<Name>.css`, an `index.ts`, tests (Testing Library, user-event, jest-axe) and stories. Use `ComponentPropsWithRef` and take `ref` as a regular prop. Export it from `src/index.ts`.
2. In the CSS use only `--semantic-*` and `--component-*` variables: no primitives, no raw colors, no `var()` fallbacks (the scanners in `test/cssRules.test.ts` enforce this for every `src/**/*.css`). Add `@media (forced-colors: active)` and `prefers-reduced-motion` rules where relevant.
3. Add the component's tokens to `tokens/default.tokens.json` (alias semantic tokens; touch `acme.tokens.json` only if a primitive must differ), then run `pnpm generate:theme` and keep the regenerated `src/themes.generated.css`.
4. **Add every text/background and non-text/background pair the component renders to `test/contrastPairs.ts`**, with the background the foreground really sits on (labels sit on the page surface, an input's own text on the input background), then fix tokens, not thresholds, if a pair fails.
   **This step is manual and the tests cannot enforce it.** They check the entries that exist in both themes, and that a component folder with CSS has at least one entry, but nothing notices a pair that was never registered. Review it by hand. Since ADR 0010, real-browser axe checks the **text** contrast of every story in both themes, so a missing text pair is caught there once the component has a story; the registry still owns **non-text** pairs (borders, icons, focus rings), which axe does not measure, and hover states, which axe does not reach.
5. Add stories for every state that matters (they are the fixtures of the e2e suite), build Storybook and run `pnpm test:e2e`. Fix CSS or tokens, never the tests; do not exclude axe rules. Behavior that jsdom cannot provide (native `<dialog>` methods, focus order, inert, `::backdrop`) is covered by e2e only: say so in the unit test comments, and use a test double for jsdom (`test/support/dialogDouble.ts`) rather than skipping the unit tests. Also add the new component to the lists in `test/componentCss.test.ts` and `test/stories.test.ts` and its min-size tokens to `MIN_SIZE_TOKENS`.
6. Update this file's status and the relevant ADR.

## Working agreements

- Explain the reasoning behind non-trivial decisions.
- Flag risks and gaps explicitly instead of agreeing by default.
- Do only what the current prompt asks. No extra scaffolding.
- Don't write dependency versions from memory. Install with the package manager and report the resolved major versions.
- Run typecheck and tests after changes and report the result honestly, including failures and anything skipped.
- Prefer small, reviewable changes.

## Definition of done

The same sequence CI runs must pass locally:

- `pnpm typecheck` passes.
- `pnpm lint` passes.
- `pnpm format:check` passes (run `pnpm format` to fix; Markdown is not formatted).
- `pnpm db:up` is running (Docker), the committed migrations apply to a **fresh** database (`pnpm db:reset --yes`, or `pnpm db:migrate` on an empty one), and `pnpm db:drift` reports no difference.
- `pnpm test` passes, including the database tests (real Postgres). The API suite includes real-concurrency tests (the brand-row lock, ADR 0014) and takes about 2.5 minutes; do not lower an iteration count to speed it up. Running two copies of it at once against one database corrupts both (the tests truncate every table).
- `pnpm build` passes, and `pnpm smoke:api` passes against the built output **with no `.env` file and no database running** (it uses dummy values and expects `/ready` to be 503).
- `pnpm generate:theme` leaves no diff (the committed `packages/ui/src/themes.generated.css` is up to date), and `pnpm --filter @dts/ui build-storybook` passes.
- `pnpm test:e2e` passes against the freshly built Storybook (one-time browser install: `pnpm --filter @dts/ui exec playwright install chromium`; `pnpm --filter @dts/ui test:e2e:build` builds first). A failing e2e test is a finding to fix in CSS or tokens, not in the test (ADR 0010).
- `pnpm test:e2e:web:build` passes (needs Docker Postgres up and Chromium installed; ADR 0016). `pnpm test` already includes the web unit tests.
- No TODOs left silently. Any TODO must be called out in the report or tracked explicitly.
