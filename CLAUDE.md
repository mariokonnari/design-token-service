# design-token-service

A multi-tenant Design Token & Theming service. Teams log in, manage their brand's design tokens (color, spacing, typography), preview them live against an accessible React component library, and export them as CSS variables or JSON.

> Status: scaffolded pnpm monorepo with ESLint + Prettier (import-boundary rules), a built-output API smoke test and GitHub Actions CI. `apps/web`, `apps/api` (`GET /health`) and `packages/ui` are still placeholders with one test each.
> `packages/tokens-core` now has the real token model: `flatten`/`nest`, literal validation, alias `resolve` with cycle detection, and `checkTiers` (ADR 0006). Exporters (CSS variables, JSON) are not built yet.
> Not built yet: Prisma/PostgreSQL, JWT auth, Storybook, axe tests, exporters. The layout below is the **target**; anything listed there beyond the above is still planned.

## Target layout

```
apps/
  web/            Vite + React + TypeScript — the Theme Editor
  api/            Node + Express + TypeScript, Prisma, PostgreSQL, JWT auth
packages/
  tokens-core/    Pure TypeScript: DTCG-style token parsing, alias resolution
                  with cycle detection, validation, exporters
  ui/             Accessible React components consuming CSS custom properties;
                  Storybook, Testing Library + axe
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

Decisions: [0001 monorepo](docs/decisions/0001-monorepo-structure.md), [0002 tokens and theming](docs/decisions/0002-token-model-and-theming.md), [0003 package consumption](docs/decisions/0003-workspace-package-consumption.md), [0004 TypeScript 6 pin](docs/decisions/0004-typescript-6-pin.md), [0005 linting and boundaries](docs/decisions/0005-linting-and-boundaries.md), [0006 token subset and tier rules](docs/decisions/0006-token-subset-and-tier-rules.md).

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
- `pnpm test` passes.
- `pnpm build` passes, and `pnpm smoke:api` passes against the built output.
- No TODOs left silently. Any TODO must be called out in the report or tracked explicitly.
