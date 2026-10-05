# 0002. Token model and theming

- Status: Accepted
- Date: 2026-10-05
- Refined by [0006](0006-token-subset-and-tier-rules.md) (supported subset, strict names, tier rules; the "components consume only semantic tokens" wording below is superseded there)

## Context

The service lets each tenant (team/brand) define design tokens, preview them live, and export them as CSS variables or JSON. We need a token format that is interoperable with other tooling, a structure that keeps brand changes cheap, and a runtime theming mechanism that supports multiple tenants and live preview without rebuilding anything.

The W3C Design Tokens Community Group (DTCG) published its first stable specification version, 2025.10, on 2025-10-28. The spec also defines separate Color and Resolver modules.

## Decision

1. **Token format: DTCG-style JSON.** We target DTCG spec version **2025.10** and implement a **documented subset** of it. Tokens use `$value` / `$type`, and aliases use `{path.to.token}` references. The supported subset will be documented alongside `tokens-core`.
2. **Three tiers**, each referencing only the tier below:
   - **Primitive** — raw values (`color.blue.500`).
   - **Semantic** — intent (`color.action.primary` -> `{color.blue.500}`).
   - **Component** — component-specific (`button.background` -> `{color.action.primary}`).
   
   Components consume **only semantic tokens**.
3. **Theming via CSS custom properties scoped to a wrapper element** (for example a `[data-theme]` attribute or tenant class on a container), not on `:root`. Switching or previewing a theme means changing the variables on that wrapper.
4. **Default theme CSS for `packages/ui` is generated at build time** from the token source using `tokens-core` as a devDependency / build step, so the default theme cannot drift from the tokens. `ui` has no runtime import of `tokens-core`; components only read CSS custom properties. (See ADR 0001.)

## Alternatives considered

- **Flat key/value tokens.** Simpler, but no standard shape, no `$type`, and no path to interoperability with other design-token tools.
- **Style Dictionary as the engine.** Mature and extensible. Rejected as the core because alias resolution, cycle detection, validation, and the tenant/preview workflow are central to this project and are part of what it is meant to demonstrate. May still be reasonable as an export target later.
- **Runtime theme objects (CSS-in-JS / theme provider).** Typed, but ties theming to one styling approach, forces re-renders on change, and doesn't produce a portable CSS export.
- **Variables on `:root`.** Simplest, but only one theme can be active per document, which breaks side-by-side previews and multi-tenant embedding.
- **Tailwind config-based theming.** Couples tokens to a build-time config, which doesn't fit user-edited tokens previewed live.
- **Two tiers only (primitive + semantic).** Less boilerplate, but component-level overrides would have to bypass the semantic layer or add ad hoc variables.

## Consequences

- We implement only a subset of DTCG 2025.10, so we must document exactly what is and isn't supported. Tokens that are valid DTCG but outside the subset must be rejected clearly rather than silently mishandled.
- The spec has separate **Color** and **Resolver** modules that we have not yet decided how to handle. Token value shapes (notably color) may therefore change before the schema is finalized, which could force a migration of stored tenant data.
- We must write and maintain our own alias resolution, cycle detection, validation, and exporters. That is more code and more bugs than adopting an existing engine.
- Three tiers add indirection and boilerplate, and can feel heavy for small brands. Tracing a value through aliases takes tooling support in the editor.
- "Components consume only semantic tokens" is a convention. It needs enforcement (lint rule, tests, or checks in the component build); until then it is only guidance.
- CSS custom properties are untyped and fail quietly: a missing or invalid variable shows up as a computed-value fallback, not an error. Validation must therefore happen in `tokens-core`, not in CSS.
- Wrapper-scoped variables do not reach elements rendered outside the wrapper. Portals (modals, tooltips, popovers) attached to `document.body` will escape the theme unless the library renders them inside the scope or re-applies the variables.
- Accessibility (for example contrast between semantic foreground/background pairs) cannot be checked by CSS. It must be computed in `tokens-core` against resolved values, and that depends on how color values are represented (see the Color module question above).
- Multi-tenancy implies per-tenant CSS output, which brings caching and invalidation concerns when tokens change.
- Live preview is cheap (swap variable values on the wrapper), but the exported CSS/JSON and the preview must come from the same resolver, otherwise they can disagree.
- Build-time generation of the default theme means `ui`'s build depends on `tokens-core` being built first, and requires deciding whether the generated CSS is committed (see ADR 0001).
