# 0005. Linting, formatting and import boundaries

- Status: Accepted
- Date: 2026-10-05

## Context

The project's architecture depends on a few rules that are easy to break and hard to notice in review: `packages/ui` must not import `tokens-core` at runtime (components only read CSS custom properties), and `tokens-core` must stay pure logic (no React, no Express, no Node). ADRs 0001 and 0002 recorded both as conventions "until a lint rule is added".

The Vite template used for `apps/web` shipped with Oxlint. We want one linter for the whole repo, with accessibility and React hooks rules for the UI code, type-aware rules for TypeScript, and a formatter, all run the same way locally and in CI. TypeScript is pinned to 6.x ([ADR 0004](0004-typescript-6-pin.md)) specifically so type-aware linting stays possible.

## Decision

1. **ESLint, flat config, one root `eslint.config.mjs`** run as `pnpm lint` (`eslint .`).
   - `typescript-eslint` with the type-checked recommended set and `projectService`.
   - `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` for `apps/web` and `packages/ui`.
   - `eslint-plugin-react-refresh` is deliberately not used.
2. **Prettier** for formatting (`pnpm format`, `pnpm format:check`), with `semi: false`, `singleQuote: true`, `endOfLine: "lf"`. Markdown files are excluded. `.gitattributes` forces LF (`* text=auto eol=lf`) so Windows checkouts pass the same check as CI.
3. **Boundary rules via `no-restricted-imports`**, each scoped to the folder it protects:
   - `packages/ui/src/**` must not import `@dts/tokens-core` (or its subpaths). Files outside `src` (build scripts that generate the default theme CSS) may. `import type` is also blocked, since the base rule does not distinguish.
   - `packages/tokens-core/src/**` must not import `react`, `react-dom`, `express`, `node:*` or bare Node built-ins (the list comes from `node:module`'s `builtinModules`). `*.test.ts` files and config files are exempt.
4. **Oxlint is removed** from `apps/web` (script, config, dependency) so there is a single linter.
5. **ESLint is on the 9.x line**, not the latest major (see Consequences).

## Alternatives considered

- **Keep Oxlint (from the Vite template).** Very fast and zero-config, and it is what the template ships. Rejected as the single linter because the decision was to standardize on the typescript-eslint ecosystem (type-aware rules, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`, `no-restricted-imports`), which the TypeScript pin in ADR 0004 already assumes. **Not verified:** how far Oxlint's own type-aware and plugin support has come; this was not benchmarked or evaluated in depth, so the choice rests on ecosystem familiarity and consolidation, not on a measured gap.
- **Oxlint plus ESLint.** Two linters, two configs, overlapping rules and two places to look. Rejected in favor of a single tool. Revisit if ESLint's speed becomes a problem.
- **Biome.** One tool for lint and format, fast. Rejected for the same reason as Oxlint (we want the typescript-eslint ecosystem); not evaluated in depth.
- **ESLint without boundary rules (rely on review).** What ADRs 0001/0002 had. Rejected: the two rules protect the architecture and are cheap to enforce.
- **A dedicated boundary tool** (for example dependency-cruiser or `eslint-plugin-boundaries`). More expressive, but another dependency and configuration model for two rules that `no-restricted-imports` expresses directly. Revisit if the rule set grows.
- **Per-package ESLint configs.** More local flexibility, but duplicated configuration and a higher chance of drift. Rejected for now.

## Consequences

- **Coupled to TypeScript 6.** typescript-eslint declares a `typescript` peer range of `>=4.8.4 <6.1.0`, so moving the compiler to 7.x also requires typescript-eslint to support it (the revisit trigger in ADR 0004). Until then, TypeScript and the linter must move together.
- **ESLint is one major behind.** The latest ESLint major conflicts with the peer range of `eslint-plugin-jsx-a11y` (which declares support up to ESLint 9), and the installed 9.x release is flagged as deprecated by the registry. Upgrading needs a jsx-a11y release that supports the newer major, or replacing that plugin. This was handled by staying on 9.x rather than overriding peer dependencies.
- **ESLint config has a real cost.** A flat config with type-aware rules, three scoped rule sets and globals per environment is code that must be maintained, and each new package or tsconfig layout may need config changes (for example `projectService` with solution-style tsconfigs such as `apps/web`).
- **Type-aware linting is slower** than syntax-only linting, because it builds TypeScript programs. This matters more as the repo grows.
- **Boundaries are only as good as their patterns.** `no-restricted-imports` matches import specifiers, not the dependency graph. It will not catch a relative path that reaches into another package's folder, `require()`, or an indirect dependency (a module in `tokens-core` that re-exports something impure from elsewhere). It also does not enforce "components use only semantic tokens"; that remains a convention.
- **Prettier is not applied to Markdown**, so docs formatting is by hand, and the `.md` exclusion means CLAUDE.md and the ADRs are not checked.
- **Losing Oxlint drops its React rule `react/only-export-components`.** We chose not to replace it with `eslint-plugin-react-refresh` for now.
- **Lint and format are not auto-run on commit** (no hooks, by decision); they are enforced by CI after the push.
