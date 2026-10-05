# 0001. Monorepo structure

- Status: Accepted
- Date: 2026-10-05

## Context

The project has two applications (a Theme Editor web app and an API) and two shared packages (token logic and a React component library). The token logic — parsing, alias resolution, cycle detection, validation, exporting — is needed by both the API (validate and export on the server) and the web app (live preview and client-side validation). It must behave identically in both places. The component library is consumed by the web app and developed in isolation with Storybook.

This is a small, single-developer project, so tooling overhead matters as much as scalability.

## Decision

1. Use a **single repository with pnpm workspaces** (`apps/*`, `packages/*`). No Turborepo or Nx.
2. Put token logic in **`packages/tokens-core`**, a pure-TypeScript package with no Node, DOM, or React dependencies, shared by `apps/api` and `apps/web`.
3. Dependency direction:
   - `apps/web` -> `packages/ui`, `packages/tokens-core`
   - `apps/api` -> `packages/tokens-core`
   - `packages/ui` must **not** import `tokens-core` at runtime. It may depend on `tokens-core` as a devDependency / build step to generate its default theme CSS from the token source, so the default theme cannot drift from the tokens.

## Alternatives considered

- **Polyrepo (one repo per app/package).** Rejected: sharing `tokens-core` would require publishing and versioning it for every change, which is heavy for one developer and slows iteration.
- **npm or Yarn workspaces.** Viable. pnpm preferred for its strict dependency resolution (it exposes undeclared dependencies) and efficient disk use.
- **pnpm + Turborepo or Nx.** Provides task caching, affected-only runs, and dependency-aware task ordering. Rejected for now: at four packages the gains are small and it adds configuration and concepts to learn and maintain. Can be added later without restructuring.
- **Duplicate token logic in api and web.** Rejected: the two copies would drift, and the preview could disagree with the exported output.
- **Keep token logic only in the API and call it over HTTP.** Rejected: live preview would need a network round trip per edit, and the logic would not be testable as a standalone unit.

## Consequences

- No task caching and no "only run what changed". CI time grows with the repo, and cross-package tasks are run by hand with `pnpm -r` or `--filter`. Revisit when CI becomes slow or the package count grows.
- No dependency-aware task ordering. `ui`'s build-time use of `tokens-core` means `tokens-core` must be built before `ui`. With pnpm alone this is handled through topological ordering in `pnpm -r` scripts, which is easy to get subtly wrong.
- Whether the generated default theme CSS is committed or produced during the build is **undecided**; it will be settled at scaffold time. Committing it risks stale output; generating it makes every consumer's build depend on the generator.
- Module boundaries are enforced only by convention. Nothing stops `ui` from importing `tokens-core` at runtime except review, until a lint rule (for example restricted imports) is added. This is a known gap.
- Workspace packages need a deliberate strategy for how they are consumed (built output vs. TypeScript sources/project references, and `exports` fields). This is a common source of setup friction in TypeScript monorepos.
- pnpm's strictness will surface phantom-dependency errors early. That is the intent, but it has a learning cost.
- A single shared lockfile means one problematic dependency upgrade affects every package.
- `tokens-core` being pure keeps it fast to test and portable, but means anything environment-specific (file access, Prisma, DOM) must live outside it.
