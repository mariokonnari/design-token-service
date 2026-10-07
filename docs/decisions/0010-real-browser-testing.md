# 0010. Real-browser testing of the component library

- Status: Accepted
- Date: 2026-10-06
- Builds on: [0008](0008-ui-styling-and-theme-generation.md), [0009](0009-form-controls-and-alerts.md)

## Context

ADR 0008 and 0009 admit what jsdom plus axe cannot do: there is no layout engine and our CSS is not loaded, so color contrast on rendered pixels, focus visibility, target size, forced colors and reduced motion were checked only from tokens or as CSS text. The token contrast registry is also a manual list that nothing forces to be complete.

## Decision

Test the **built Storybook** in a real Chromium with Playwright, from `packages/ui/e2e/`.

- **Stories as fixtures.** Every story is a rendered, themed state of a component. The specs read `storybook-static/index.json` and generate one test per story and theme, so a new story is covered with no new test code, and a story that cannot render fails the suite. Stories open in the preview iframe (`iframe.html?id=<id>&viewMode=story&globals=theme:<slug>`) using the real toolbar global `theme`.
- **No vacuous passes.** Every story load asserts that the `ThemeScope` element carries the requested `data-theme` and that the theme's variables are defined on it, so a broken theme switch fails instead of testing the default theme twice. A harness test checks that every component with stories in `src` appears in the built index (a stale build cannot pass). Specs also assert that what they measure exists: axe must have evaluated contrast nodes (stories made only of disabled controls are listed explicitly), the target-size test must find interactive elements, and the reduced-motion test must find real motion in normal mode.
- **What is covered** (`pnpm test:e2e`; 270 tests when this ADR was written, and the count grows with every story and component, see ADR 0011):
  - `axe.spec.ts`: axe with `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` on every story in both themes, including `color-contrast` on real pixels. Zero violations; "incomplete" contrast results fail the test.
  - `theming.spec.ts`: the primary Button's computed background differs between themes.
  - `focus.spec.ts`: reaching Button, TextField input and Checkbox input with the **keyboard** (Tab) shows `:focus-visible`, an outline of at least 2px that is not transparent; every enabled control of each `All` story is checked in turn.
  - `targetSize.spec.ts`: every visible interactive element is at least 24x24 CSS px. A checkbox or radio is measured through its `label`, the real click target.
  - `forcedColors.spec.ts`: with `forcedColors: 'active'`, axe again, borders and outlines still drawn, and the **resolved system color** asserted where our CSS chooses one.
  - `reducedMotion.spec.ts`: Button has motion in normal mode and none (`0s`) under `prefers-reduced-motion: reduce`.
- **Findings policy.** If a test fails on the real components that is a finding: fix the CSS or tokens (through `pnpm generate:theme`, with the drift check and the registry and threshold tests staying green), never the test. An axe result believed to be a false positive is reported and decided by a person; the rule is not excluded.
- **`retries: 0`.** An accessibility check that passes on the second try is a flaky check or a flaky component, and a retry would hide which. Failures keep a trace (`retain-on-failure`) and an HTML report is uploaded in CI.
- **Mechanics.** Chromium only. `sirv-cli` serves `storybook-static` on port 6007 in `--dev` mode (no cached file list, so a rebuild is served as is). `test:e2e` runs against an existing build; `test:e2e:build` builds Storybook first. CI installs Chromium with system dependencies, runs the suite after `build-storybook` and uploads the report and traces on failure. Vitest excludes `e2e/`.

## What it covers and what it does not

- **Text contrast: yes**, for every story and theme, as rendered. The comparison against the token registry found 138 evaluated nodes with no ratio differing by more than 0.01 and no text pair that the registry lacks; the only registry text pairs axe never measured are hover states, because axe does not hover.
- **Non-text contrast: no.** Axe does not measure borders, icons or focus rings against their backgrounds. The registry still owns those pairs, and it is still manual.
- **Not a screen reader.** Nothing here proves what is announced; live regions and reading order are untested.
- **No visual regression.** Computed styles and geometry are asserted, not pixels. Nobody looks at the rendering here.
- **Chromium only.** Firefox and Safari behave differently, notably in forced colors and for `:focus-visible` heuristics. Rendering may differ slightly between the Windows and Ubuntu runs; the numbers asserted have margin.
- **Forced colors is partly provable.** Chromium forces many colors itself, so "a border is drawn" holds even if our forced-colors rule is deleted. Measured by disabling the rules: the TextField invalid border (`Highlight`), the Checkbox `accent-color` and the disabled Checkbox label (`GrayText`) are observable and asserted; the Alert border and icon, the Button border and the disabled Button and TextField colors are **indistinguishable from the browser's own behaviour**, so removing those rules does not fail a test. They stay in the CSS for engines that behave differently and are asserted only as resolved system colors.
- **Reduced motion** only covers elements that appear in a story; a new animation in a component without a story is invisible to it.
- **Hover and active states** are not exercised.
- **CI time cost.** About 2 minutes of tests locally on four workers, plus the Chromium download and system dependencies on every CI run (no browser cache), and a Storybook build. The job timeout was raised from 15 to 25 minutes. These figures are estimates, not measured on CI.
- **Two axe-core versions** are installed (4.12.1 through jest-axe in jsdom, 4.13 through `@axe-core/playwright`). They are independent and may disagree on edge cases.

## Alternatives considered

- **Vitest browser mode.** Runs component tests in a real browser with the Vitest tooling we already use. Rejected for now: it would render components in isolation rather than the same stories people review, it adds a second way to mount components, and the Playwright API is stronger for keyboard, media emulation and axe.
- **Storybook test-runner** (or Storybook's Vitest addon). It already runs stories as tests. Rejected: it gives us less control over theme matrices, forced-colors and reduced-motion emulation, and per-story assertions, and it is another layer to depend on; plain Playwright against the static build keeps the contract small.
- **Playwright against the Storybook dev server.** Faster feedback, but it tests a development build and starts a heavy server in CI. Testing the built output is what is shipped and matches the existing `build-storybook` check.
- **Excluding or tuning axe rules** to get green. Rejected by the findings policy.

## Consequences

- Real-browser text contrast now backs the token registry. The registry remains authoritative for non-text pairs and remains manual.
- A story is a test fixture: keep stories deterministic, and add stories for states that matter (the `All` stories double as keyboard-walk fixtures).
- CI is slower and depends on downloading a browser.
- The suite proves the checks can fail (each breakage was applied, Storybook rebuilt, and the matching test confirmed red before the file was restored) but that was a one-off exercise, not an automated one.
- **Checkbox target.** The native checkbox is 18x18; its label is the click target (at least 28px tall). Axe's `target-size` passes the input through its 24px-spacing exception, not by size. Our own test measures the label. If the checkbox is ever laid out with tighter spacing, axe may start to flag the input and the decision about the label as target will need revisiting.
