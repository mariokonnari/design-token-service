# design-token-service

A multi-tenant Design Token & Theming service. Teams log in, manage their brand's design tokens (color, spacing, typography), preview them live against an accessible React component library, and export them as CSS variables or JSON.

> Status: scaffolded pnpm monorepo with ESLint + Prettier (import-boundary rules), a built-output API smoke test and GitHub Actions CI. `apps/web` and `apps/api` (`GET /health`) are still placeholders.
> `packages/ui` now has a foundation (ADR 0008): themes generated from `tokens/*.tokens.json` into the committed `src/themes.generated.css` (`pnpm generate:theme`, drift-checked in CI), `ThemeScope`, accessible `Button`, `TextField`, `Checkbox` and `Alert` (ADR 0009), `Tabs` (compound, roving tabindex) and a native-`<dialog>` `Dialog` (ADR 0011), tests that enforce the styling rules (no primitives, no raw colors, no `var()` fallbacks, every variable defined in every theme, forced-colors/focus/reduced-motion structure) and a declarative contrast registry (`test/contrastPairs.ts`, checked for every theme), and Storybook with the a11y addon and a theme toggle (`pnpm --filter @dts/ui storybook`). Built-in text is English-only by default and overridable by props; the library ships no translations.
> Real-browser tests (ADR 0010): Playwright runs against the BUILT Storybook in Chromium (`pnpm test:e2e`, specs in `packages/ui/e2e/`): axe with WCAG 2.0 to 2.2 A/AA tags (including real-pixel text contrast), theming, keyboard focus rings, 24px target size, forced colors and reduced motion, for every story in both themes. Not covered: non-text contrast (the registry still owns it), screen readers, visual regression, other browsers.
> `packages/tokens-core` now has the real token model: `flatten`/`nest`, literal validation, alias `resolve` with cycle detection, and `checkTiers` (ADR 0006), plus the exporters `toCssVariables` (scoped CSS custom properties, collision detection, escaping) and `toResolvedTree` (JSON), and sRGB color/contrast utilities (WCAG 2.x) (ADR 0007).
> `apps/api` now has a data foundation (ADR 0012): Postgres 17 in Docker (`pnpm db:up`), a Prisma 7 schema with committed migrations and hand-written CHECK constraints, zod-validated config that fails closed, `GET /health` (liveness, no DB) and `GET /ready` (DB query, 503 when unreachable), a real-Postgres test harness (a separate `*_test` database, serial test files, a guard that refuses any other database), and a repository skeleton (`TenantScope` + one policy module + a lint rule that keeps the Prisma client inside `src/db` and `src/repositories`). The API does not connect to the database at startup.
> Not built yet: authentication/sessions, any HTTP route beyond `/health` and `/ready`, deployment (Supabase/Render, see ADR 0012), Postgres row-level security, any API or editor use of the exporters, components beyond `Button`, `TextField`, `Checkbox`, `Alert`, `Tabs` and `Dialog`, APCA. The layout below is the **target**; anything listed there beyond the above is still planned.

## Target layout

```
apps/
  web/            Vite + React + TypeScript — the Theme Editor
  api/            Node + Express + TypeScript, Prisma, PostgreSQL, JWT auth
    prisma/       schema.prisma, committed migrations (CHECK constraints live in the SQL)
    src/config/   zod-validated environment (parseEnv)
    src/db/       the ONLY place the Prisma client / adapter / pg may be imported (plus repositories)
    src/repositories/  data access: every function takes a TenantScope first
    src/tenancy/  TenantScope + issueTenantScope (auth middleware only) + policy.ts (roles)
    test/         DB tests (real Postgres), guard, convention test
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

Decisions: [0001 monorepo](docs/decisions/0001-monorepo-structure.md), [0002 tokens and theming](docs/decisions/0002-token-model-and-theming.md), [0003 package consumption](docs/decisions/0003-workspace-package-consumption.md), [0004 TypeScript 6 pin](docs/decisions/0004-typescript-6-pin.md), [0005 linting and boundaries](docs/decisions/0005-linting-and-boundaries.md), [0006 token subset and tier rules](docs/decisions/0006-token-subset-and-tier-rules.md), [0007 CSS export and contrast](docs/decisions/0007-css-export-and-contrast.md), [0008 UI styling and theme generation](docs/decisions/0008-ui-styling-and-theme-generation.md), [0009 form controls and alerts](docs/decisions/0009-form-controls-and-alerts.md), [0010 real-browser testing](docs/decisions/0010-real-browser-testing.md), [0011 tabs and dialog](docs/decisions/0011-tabs-and-dialog.md), [0012 data model and tenancy](docs/decisions/0012-data-model-and-tenancy.md).

## API and database

Needs Docker (Desktop) for the local database. First time: `cp apps/api/.env.example apps/api/.env`, then:

- `pnpm db:up` starts Postgres (waits for the healthcheck); `pnpm db:down` stops it; `pnpm db:reset` **deletes the local volume** after asking you to type `reset` (`--yes` skips the prompt; it refuses without a terminal otherwise) and re-applies the migrations.
- `pnpm db:migrate` applies the committed migrations (`prisma migrate deploy`); `pnpm db:migrate:dev` authors a new one (needs the `<db>_shadow` database, created on demand); `pnpm db:drift` fails if `schema.prisma` and the migrations disagree; `pnpm db:studio`; `pnpm db:generate` regenerates the client (`pnpm install` does it through `postinstall`; the generated client in `apps/api/src/generated` is not committed).
- `pnpm --filter api dev` runs the API with `--env-file=.env`; `start` loads no file. Required variables: `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET` (32+ characters, no default anywhere); optional `PORT`, `SIGNUP_ENABLED`, `ALLOWED_ORIGINS`. A missing or invalid variable stops the app with one message listing all of them.
- Tests: `pnpm test` runs the API tests against `dts_test` (created and migrated by the global setup). They **refuse to run** unless `DATABASE_URL` names a database ending in `_test`, and they run files serially because they truncate every table between tests.
- Prisma is pinned to 7.x (npm's `latest` tag points at the 8 release candidate: install with `@7`). Prisma's own install scripts are explicitly ignored in `pnpm-workspace.yaml`; do not approve them without reading ADR 0012.
- CHECK constraints are only guarded by `apps/api/test/db/constraints.test.ts` (the drift check cannot see them). Add a test with every new one.
- Repository rules (ADR 0012): every repository function takes a `TenantScope` first, calls `requireScope`, filters by `scope.organizationId` in every query and asks `tenancy/policy.ts` about roles. Only the auth middleware may import `issueTenantScope`. A cross-tenant read returns "not found", never 403.

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
- `pnpm test` passes, including the database tests (real Postgres).
- `pnpm build` passes, and `pnpm smoke:api` passes against the built output **with no `.env` file and no database running** (it uses dummy values and expects `/ready` to be 503).
- `pnpm generate:theme` leaves no diff (the committed `packages/ui/src/themes.generated.css` is up to date), and `pnpm --filter @dts/ui build-storybook` passes.
- `pnpm test:e2e` passes against the freshly built Storybook (one-time browser install: `pnpm --filter @dts/ui exec playwright install chromium`; `pnpm --filter @dts/ui test:e2e:build` builds first). A failing e2e test is a finding to fix in CSS or tokens, not in the test (ADR 0010).
- No TODOs left silently. Any TODO must be called out in the report or tracked explicitly.
