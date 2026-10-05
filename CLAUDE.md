# design-token-service

A multi-tenant Design Token & Theming service. Teams log in, manage their brand's design tokens (color, spacing, typography), preview them live against an accessible React component library, and export them as CSS variables or JSON.

> Status: scaffolded pnpm monorepo. All four workspaces exist with placeholder code and one test each (`apps/web`, `apps/api` with `GET /health`, `packages/tokens-core`, `packages/ui`), plus ESLint + Prettier with import-boundary rules, a built-output API smoke test, and GitHub Actions CI.
> Not built yet: Prisma/PostgreSQL, JWT auth, Storybook, axe tests, and any real token logic (parsing, alias resolution, validation, exporters). The layout below is the **target**; anything listed there beyond the above is still planned.

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

Decisions: [0001 monorepo](docs/decisions/0001-monorepo-structure.md), [0002 tokens and theming](docs/decisions/0002-token-model-and-theming.md), [0003 package consumption](docs/decisions/0003-workspace-package-consumption.md), [0004 TypeScript 6 pin](docs/decisions/0004-typescript-6-pin.md), [0005 linting and boundaries](docs/decisions/0005-linting-and-boundaries.md).

## Token architecture

Tokens are W3C DTCG-style JSON (`$value` / `$type`). Aliases reference other tokens with `{path.to.token}`.

Three tiers, each referencing only the tier below it:

1. **Primitive** — raw values (`color.blue.500`, `space.4`).
2. **Semantic** — intent, aliasing primitives (`color.action.primary` -> `{color.blue.500}`).
3. **Component** — component-specific, aliasing semantic tokens (`button.background` -> `{color.action.primary}`).

**Components consume only semantic tokens.** They never reference primitives directly.

```json
{
  "color": {
    "blue": { "500": { "$type": "color", "$value": "#2563eb" } },
    "action": { "primary": { "$type": "color", "$value": "{color.blue.500}" } }
  }
}
```

(Illustrative only; the supported subset and value shapes are defined in ADR 0002 and will be documented when the schema is finalized.)

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
