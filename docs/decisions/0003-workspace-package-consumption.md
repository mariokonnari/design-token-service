# 0003. Workspace package consumption: TypeScript sources, no dist build

- Status: Accepted
- Date: 2026-10-05

## Context

[ADR 0001](0001-monorepo-structure.md) set up two shared packages (`@dts/tokens-core`, `@dts/ui`) and left open how they are consumed by the apps: as built output (`dist`) or directly as TypeScript source. Without Turborepo or Nx there is no dependency-aware task runner, so a `dist`-based setup needs a manual build order before anything downstream can typecheck, test or run in dev, and it needs either TypeScript project references or a build step in front of every `typecheck`.

Consumers in this repo: `apps/web` (Vite), `apps/api` (`tsx` in development, plain Node in production), and the packages' own Vitest runs.

## Decision

1. `@dts/tokens-core` and `@dts/ui` are **consumed as TypeScript source**: their `exports` point at `./src/index.ts`. They have no `build` script and produce no `dist`.
2. Consumers reference them with the `workspace:*` protocol.
3. Each consumer's toolchain compiles the sources itself:
   - `apps/web`: Vite.
   - `apps/api` in development: `tsx watch`.
   - Vitest: its own transform.
4. `apps/api` is **bundled with tsup** (ESM output, `"type": "module"`) for production, with `noExternal: ['@dts/tokens-core']`. tsup externalizes `dependencies` by default, which would leave an `import` of a raw `.ts` file in the output that plain Node cannot load. Bundling the workspace package into `dist/index.js` avoids that. Third-party dependencies such as `express` stay external.
5. Type resolution relies on `moduleResolution: Bundler` (from `tsconfig.base.json`), which accepts an `exports` entry that points at a `.ts` file.

## Alternatives considered

- **Build each package to `dist` (tsc), with `exports` pointing at the output.** The conventional model, and the one that makes the packages publishable. Rejected for now: with no task runner, `typecheck`, `test` and `dev` in the apps would all depend on the packages having been built first, so ordering has to be maintained by hand. It adds a watch/rebuild loop for local development and gains nothing while nothing is published.
- **TypeScript project references (`tsc -b`) with `composite` packages.** Gives incremental, ordered builds and typechecks without a separate bundler step. Rejected: more configuration, `.d.ts` emit in every package, and it does not remove the need to emit JavaScript for the API's runtime.
- **A custom `exports` condition** (for example `"development": "./src/index.ts"`, default `./dist/...`). Keeps the packages publishable while using sources locally. Rejected as premature: it needs both a working `dist` build and condition support in every tool, which is the cost of the `dist` approach plus extra complexity.
- **Bundle the API with a different tool, or run it with `tsx` in production.** Running `tsx` in production keeps a TypeScript runtime loader in the deployed process. Not chosen; tsup is a small, well-understood bundler for this job.

## Consequences

- **The packages are not publishable as they stand.** Anything that installs them from a registry, or imports them from plain Node, would receive `.ts` files. Publishing needs a build step and `exports` changes first.
- **The API needs a bundler.** tsup is an extra dependency purely because of this decision. It also needs a manually maintained `noExternal` list: if a new workspace package is added as an API dependency and not listed, the build still succeeds but the output fails at runtime under plain Node. The only guard is smoke-testing the built output (`pnpm build`, then `node dist/index.js`). That check should be automated in CI.
- **Every consumer must understand TypeScript sources.** Vite, `tsx`, Vitest and tsup all do today. A future consumer that does not (a plain Node script, a tool that skips transforming files reached through symlinks outside `node_modules`) would break.
- **Consumers typecheck the libraries' sources under their own `tsconfig`.** A package's code is checked once per consumer with that consumer's compiler options, so a stricter app setting (for example `noUnusedLocals` in `apps/web`) can surface errors in library code, and a library can pass its own check while failing a consumer's. Import specifiers inside the packages must be extensionless, because the base config does not enable `allowImportingTsExtensions`.
- **No build output means no declaration files**, so project references are not available as a later drop-in. Moving to `dist` later is a real migration, not a flag.
- **Build-time generation of the `ui` default theme CSS** (from ADR 0001/0002) benefits: it can run `tokens-core` straight from source, so there is no build-order dependency between the two packages. Whether the generated CSS is committed or generated during the build is still undecided.
- **Duplicate-dependency risk is higher.** Because library source is compiled in the consumer's context, a second copy of `react` or `react-dom` from the library's own `node_modules` would produce two React instances. The workspace is therefore held to a single copy of each, and `ui` declares `react` as a peer dependency with a broad range (and as a devDependency for its own tests).

## Revisit when

- `@dts/ui` (or `tokens-core`) needs to be published or consumed outside this repo.
- Storybook or CI introduces friction with TypeScript-source packages (for example tooling that does not transform files reached through workspace symlinks, or typecheck times growing because libraries are re-checked per consumer).
