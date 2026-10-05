# 0004. Pin TypeScript to the 6.x line

- Status: Accepted
- Date: 2026-10-05

## Context

When the root `typescript` devDependency was first installed without a range, the package manager resolved TypeScript 7.0.2, the native (Go-based) compiler line. TypeScript 7.0 shipped without a stable programmatic compiler API; that API is expected in 7.1. Tools that need it, notably typescript-eslint, cannot use 7.x until then. The project will add a linter in an upcoming step, and type-aware linting is a likely requirement.

The Vite `react-ts` template used to generate `apps/web` also pinned the 6.0 line (`~6.0.2`).

## Decision

1. **Pin the root `typescript` devDependency to the 6.x line** (`^6.0.3`, as resolved by pnpm). The resolved version at the time of writing is **6.0.3**.
2. **One TypeScript version for the whole workspace**, declared only at the root. No per-workspace `typescript` entries; the template's own pin in `apps/web` was removed.
3. Every package's `typecheck` script uses that single compiler (`tsc --noEmit` or `tsc -b`).

## Alternatives considered

- **Use TypeScript 7.x now.** Faster typechecking, but it blocks typescript-eslint (and anything else that needs the programmatic API), which would force a choice between type-aware linting and the newest compiler. Rejected.
- **Use 7.x for `tsc` and 6.x for linting tooling (two versions).** Possible, but two compilers can disagree on diagnostics, and it breaks the single-version rule that keeps editor, CI and lint behavior consistent. Rejected.
- **Stay on 5.x.** Older line with no benefit here, and the current template and tooling target 6.x. Rejected.
- **Exact pin (no caret).** Maximizes reproducibility, but the lockfile already fixes the installed version; the caret accepts 6.x patch and minor updates when dependencies are deliberately upgraded. Not chosen.

## Consequences

- Typechecking uses the JavaScript-based compiler and does not get the native compiler's speed. That is fine at the current size but is a real cost as the repository grows.
- 6.x is the last JavaScript-based line, so a migration to 7.x is coming. Deprecations and option changes announced in 6.x should be taken seriously, and moving later will mean re-verifying `tsconfig` options and any tooling.
- The `^6` range allows minor releases. A 6.x minor could change diagnostics and fail typecheck after a dependency refresh, which is why updates happen deliberately through the lockfile.
- 7.x was only installed to the point of resolving it; **typecheck was never run under 7.0.2 in this repository.** This ADR is therefore based on the ecosystem constraint (no stable programmatic API, no typescript-eslint support), not on a measured incompatibility in this codebase.
- Package-level `typescript` pins are now a convention to enforce. Nothing prevents a new workspace (or a scaffolding template) from adding its own, and a second copy could silently diverge.

## Revisit when

TypeScript 7.1 ships a stable programmatic API **and** typescript-eslint supports it. At that point, evaluate moving the root pin to 7.x (single version, still one place).
