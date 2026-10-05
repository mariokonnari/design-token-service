# 0008. UI styling and theme generation

- Status: Accepted
- Date: 2026-10-05
- Builds on: [0002](0002-token-model-and-theming.md), [0003](0003-workspace-package-consumption.md), [0006](0006-token-subset-and-tier-rules.md), [0007](0007-css-export-and-contrast.md)

## Context

`packages/ui` is where the token model meets real components. Earlier ADRs decided that themes are CSS custom properties scoped to a wrapper element (0002), that `ui` is consumed as TypeScript source (0003), that `ui` source must not import `tokens-core` (0001, enforced in 0005), and how tokens-core exports CSS safely (0007). Phase 2a has to turn that into a working foundation: a default theme and a second theme built from token files, one accessible component, a place to look at it, and tests that stop the styling rules from eroding.

## Decision

### Token files, tiers and the overlay rule

Token sources live in `packages/ui/tokens/` as DTCG 2025.10 subset JSON (ADR 0006), three tiers (`primitive`, `semantic`, `component`).

- `default.tokens.json` is the **complete base**: primitive color scales (neutral, brand, red), spacing, radius, font family, sizes and weights; semantic roles (surface, text, text-muted, border, action primary/primary-hover/on-primary, danger, focus-ring, spacing, radius, typography); and `component.button` tokens.
- Every other `<slug>.tokens.json` is an **overlay**. `acme.tokens.json` overrides only the brand color scale and one radius, which proves a second brand needs no other change.
- Overlay rule (introduced here): groups merge recursively; a token replaces the base token at the same path wholesale; anything the overlay adds is added; a token-versus-group conflict, or an overlay that changes a group's `$type`, is an error; a `__proto__` key is rejected. Each overlay is also validated on its own.

The overlay rule exists because exported values are resolved literals (ADR 0007): changing a brand color changes every semantic and component value derived from it, so each theme is exported in full, and the full set has to come from base plus overlay.

### Generation, committed output and a drift check

`scripts/build-theme.ts` (run with `tsx`, `pnpm generate:theme`) reads the token files and, per theme, runs `flatten` -> `resolve` -> `checkTiers` -> `toCssVariables` with the scope `{ kind: 'attribute', name: 'data-theme', value: <slug> }` and `include: ['semantic', 'component']`. Any error-severity issue fails the build with a readable list; warnings are printed. It writes ONE committed file, `src/themes.generated.css`, with a "generated, do not edit" header and no timestamp, so the output is deterministic.

The script lives outside `src`, so the boundary lint allows its `@dts/tokens-core` import; `tokens-core` is a devDependency of `ui` only, and a test checks it never becomes a dependency or peer.

Two guards stop drift: a test regenerates the CSS in memory and compares it with the file, and CI runs `generate:theme` followed by `git diff --exit-code` on the file (and checks the file is tracked, so the diff cannot pass vacuously on an untracked file).

The package exposes the file through its exports map, keeping just-in-time source exports (ADR 0003):

```json
"exports": {
  ".": "./src/index.ts",
  "./themes.css": "./src/themes.generated.css"
}
```

Apps use `import '@dts/ui/themes.css'`. `apps/web` does so and wraps its page in `ThemeScope`, which also proves the exports map through a real Vite build.

### ThemeScope

`ThemeScope` renders a `div` with `data-theme={theme}` so a subtree picks up one theme's variables (scoped themes, ADR 0002). The slug is validated at runtime with a copy of the name rule, because `src` must not import `tokens-core`; the copy points at the source of truth in a comment, and a test checks both agree on every string up to length four over a tricky alphabet plus a fixed list. An invalid slug **throws**: a wrong theme is a programmer error and a silent fallback would hide it.

### Button, plain CSS and data attributes

`Button` is a native `<button>` with `variant` (`primary`, `secondary`), `size` (`sm`, `md`) and every native button prop; `type` defaults to `button`; `ref` is a regular prop (React 19). Styling is plain CSS in `Button.css` with `dts-` prefixed classes and `data-variant` / `data-size` attributes, consuming only semantic and component variables. The focus ring is an `outline` on `:focus-visible` (not `box-shadow`, which forced-colors mode removes), the disabled state uses the real attribute, targets are at least 24 CSS px (tokens `min-size-sm` 28px and `min-size-md` 36px), the background transition is switched off under `prefers-reduced-motion`, and a `forced-colors: active` block keeps borders and the disabled state visible using system colors.

### The rules are tests

`packages/ui/test` (outside `src`) enforces, with css-tree parsing the real CSS:

1. component CSS never mentions a primitive variable (the scan is textual and also catches comments), has no raw colors (hex, color functions, named colors; `transparent`, `inherit`, `currentColor` and system colors are allowed) and no `var()` fallbacks;
2. every `var(--x)` is defined in the generated CSS of **every** theme;
3. the generated file is up to date;
4. contrast, computed from tokens with tokens-core's `contrastRatio` for **both** themes: text, text-muted, danger on surface and on-primary on action-primary and its hover (4.5); focus-ring and border on surface (3); and every pair Button actually uses, derived from the `component.button` tokens (text-primary on bg-primary and bg-primary-hover, text-secondary on bg-secondary and bg-secondary-hover at 4.5; border-secondary on the surface at 3); plus the 24px target-size tokens. A test pins the thresholds so they cannot be lowered quietly. A failing pair means the tokens are fixed, never the threshold.

Every scanner and check has its own tests proving it can fail on a deliberately bad sample, and mutation checks (reintroducing a raw color, a fallback, a primitive reference, an undefined variable, a too-light token) each made tests fail.

### Storybook

Storybook 10.6.1 with `@storybook/react-vite` and `@storybook/addon-a11y` (the registry peer ranges accept our Vite 8, React 19 and TypeScript 6; it needs no ESLint plugin). A toolbar toggle (`default` / `acme`, driven by `.storybook/themes.ts`, which a test keeps equal to the token file slugs) is applied by a decorator that wraps stories in `ThemeScope`. Button stories cover primary, secondary, small, disabled and a matrix of every variant, size and enabled/disabled combination. Telemetry is disabled so local runs and CI make no telemetry calls.

### axe in unit tests

Accessibility checks in the component tests use `jest-axe` 11 (axe-core 4.12.1) with `expect.extend` under Vitest. It was chosen over `vitest-axe` 0.1.0, which has types and ESM but had no repository activity for about eight months and is pre-1.0; jest-axe was active at the time of choosing. It is Jest-oriented and untyped, so the repo carries a small local type declaration (`@types/jest-axe` is stale: axe-core 3, needs `@types/jest`). A test renders a button with no accessible name and asserts axe reports a violation, so the wiring is proven able to fail.

## Alternatives considered

- **Generate the CSS during the build instead of committing it.** No generated file to review or merge, but every consumer (apps, Storybook, tests) then depends on the generator having run, the CSS cannot be read in a diff, and drift between tokens and what shipped is invisible. Rejected for a reviewable committed file plus a CI check.
- **Two complete token files for the second theme.** Simpler semantics, but the duplicated semantic and component tokens could drift apart, and "a brand only overrides its primitives" would not be true in the files. Rejected for the overlay rule.
- **Ship primitives in the CSS too.** Lets anything read the brand scale, but exposes naming that components must not use and grows the file. Rejected: `include` limits it to semantic and component tokens.
- **CSS Modules or CSS-in-JS.** Scoped class names and typed styles, but they add build and runtime machinery, hide the variable usage from simple scanning, and CSS-in-JS needs runtime injection that fights the generated variable sheet. Plain CSS with a `dts-` prefix and data attributes keeps the rules enforceable by parsing the file.
- **Variant classes (`dts-button--primary`) instead of data attributes.** Equivalent; data attributes keep one base class and make the state visible in the DOM and in tests.
- **`box-shadow` focus rings.** Common, but removed in forced-colors mode. Outline is kept.
- **A `:root` default theme.** Would style unthemed pages, but then every page silently has a theme and `ThemeScope` is optional. Rejected for explicit scoping.
- **`vitest-axe`, or a hand-rolled axe matcher.** See above.
- **Browser-based component tests** (Vitest browser mode or Playwright) for contrast and focus behaviour. Not done in this phase; see the limits.

## Consequences

- **jsdom plus axe is limited.** jsdom has no layout engine and the tests do not load our CSS, so axe cannot evaluate `color-contrast`, focus visibility, target size or forced-colors behaviour there. Contrast is covered by the token contrast tests and, in a real browser, by the Storybook a11y addon; focus-visible styling, forced-colors and reduced-motion are verified only as CSS text and structure, not in a browser, and nobody has yet looked at the rendered result.
- **No runtime cascade from primitives.** Because values are resolved literals, a primitive change needs a regeneration (the drift check enforces it), and a consumer cannot override a primitive in the browser.
- **The overlay rule is new, ours and strict.** An overlay cannot change a group's `$type` or turn a token into a group; a genuinely new brand structure needs the base to change.
- **Primitives are not shipped**, so tooling that wants the brand scale (a palette preview, say) must read the token files instead.
- **A theme must be in scope.** Content outside a `ThemeScope` gets no variables, so `Button` renders without its colors; apps must wrap the page. A bad slug throws and takes the subtree down unless an error boundary catches it.
- **The scanners are deliberately strict and simple.** The primitive check is textual, so even a comment that spells a primitive variable fails; identifiers in `font-family` and `font` are skipped so a font named like a color is not flagged; a color hidden in a non-declaration position (for example inside `@import` or an unparsed raw value) would not be seen.
- **Contrast is checked for color pairs only**, with the 4.5 and 3 thresholds. Disabled text is intentionally low contrast (WCAG exempts inactive controls); hover and active states beyond the pairs listed, state combinations such as the focus ring against the primary button fill, and text over images are not covered.
- **Target size is checked from tokens**, not from the rendered box; a different CSS rule could still shrink a button.
- **The palette is a first choice**, not a design review: the hex values (a blue brand, a purple Acme brand, a neutral scale) were chosen and checked for contrast, not validated by a designer.
- **Storybook adds a large dependency tree** (it brings its own bundled test utilities and a build of roughly a megabyte of JavaScript for the preview), and a CI step to build it. The a11y addon's results have not been reviewed in a browser here.
- **jest-axe under Vitest is a compatibility shim**, not a supported combination; a future jest-axe or Vitest major could break it, and the local type declaration must be maintained.
- **TypeScript 6 checks side-effect imports**, so CSS imports need a `*.css` module declaration in this package (`src/css.d.ts`). Also, a bare `.storybook` entry in `tsconfig` `include` is skipped (dot directory), which silently excluded Storybook's own files from typecheck and lint until explicit file globs were used.
- **The Storybook toolbar list is duplicated** in `.storybook/themes.ts` rather than generated; a test keeps it equal to the token files, but a new theme still needs that file edited.
