# 0009. Form controls and alerts

- Status: Accepted
- Date: 2026-10-06
- Builds on: [0008](0008-ui-styling-and-theme-generation.md)

## Context

After `Button`, `packages/ui` gets its first form controls and a status message: `TextField`, `Checkbox` and `Alert`. These are where accessibility mistakes are most common (labels, error wiring, color-only signals, live regions) and where the styling rules from ADR 0008 (semantic and component variables only, contrast checked from tokens) have to scale beyond one component.

## Decision

### Tokens and the contrast registry

- New semantic status roles, each with a surface, a text and a border color: `semantic.color.{info,success,warning,danger}.{surface,text,border}`, plus `semantic.color.input-border` and `semantic.color.placeholder`. The earlier leaf token `semantic.color.danger` became the group `semantic.color.danger.*` (a token cannot also be a group); its old contrast pair is now `danger.text` on the surface.
- Info uses its own `blue` primitive scale, not `brand`, so a brand overlay such as `acme` (purple) does not recolor info messages. `green`, `amber` and extra `red` steps were added.
- Component tokens for `textfield`, `checkbox` and `alert` (paddings, radius, border width, gap, minimum size, icon size, accent, per-role alert colors) alias semantic tokens, with a few literals.
- The hard-coded contrast pairs were replaced by a **declarative registry**, `test/contrastPairs.ts`: `{ component, id, kind, foreground, background, min }`. It runs for every theme and includes every Button pair. A validator rejects an entry whose `min` is below the WCAG minimum for its `kind` (4.5 text, 3 non-text) so thresholds cannot be lowered quietly, and a deliberately bad pair proves the registry can fail.
- **Backgrounds are explicit and match where things render.** TextField's label, description, required hint and error text sit on the page **surface** and are registered against the surface token; only the input's own text and placeholder are registered against the input background. Borders (input, invalid) are registered against the surface and, as a separate token, against the input background; focus rings against the surface. Checkbox label and description are registered on the surface. Alert text is registered on its role background, and its border/icon on both that background and the page surface.
- Computed ratios when the colors were chosen (WCAG 2.2): alert text on its surface 8.70 to 9.52, alert border on its surface 4.75 to 5.91, input border on white 3.32, placeholder 5.74, error text 10.02, invalid border 6.47, checkbox accent and focus ring 5.17 (default) and 5.70 (acme).

### Labels, not placeholders

`label` is a required prop of `TextField` and `Checkbox` (a type-level test enforces it), rendered as a real `<label>` associated with `useId` ids (a provided `id` wins). A placeholder is never a substitute. Note that **axe does not enforce this**: axe-core 4.12 treats a placeholder as a sufficient name for an input, and a test records that. The guarantee is the required prop.

### Required, errors and descriptions

- `required` sets the native attribute and shows a visible "(required)" hint, **not only an asterisk**. The hint is `aria-hidden="true"`: the native attribute already tells assistive technology the field is required, so a visible and announced hint would be read twice. Consequently the accessible name excludes the hint. Tests check the input is `required`, the hint is visible text, and the name does not include it.
- `description` and `error` are linked with `aria-describedby` (merged with any value the caller passes). `aria-invalid="true"` is set only while there is an error and is otherwise absent.
- The error text is preceded by a visually hidden "Error: " and a decorative `aria-hidden` icon, so color is never the only signal.
- **Errors that appear after a submit are not announced by themselves.** The error is linked to the input and read when the input is focused, but nothing moves focus or announces it. Moving focus to the field or an error summary, or using an `Alert` or another live region, is the consumer's responsibility.

### No translations

The library has no built-in English-only text. Every built-in string is an optional prop with an English default: `requiredHint` (default "(required)") and `errorPrefix` ("Error: ") on `TextField`, and `labelPrefix` on `Alert` ("Information: ", "Success: ", "Warning: ", "Error: " by variant; `''` omits it). Tests check that overriding changes the output. **The library does not ship translations**; consumers pass them.

### Checkbox

A native `<input type="checkbox">` inside a real `<label>`, with `accent-color` from a token. `indeterminate` is a DOM property, so it is set in an effect that runs after every render and the prop stays authoritative; the browser clears it on click, so callers update the prop in `onChange`. The label has a minimum size token of at least 24px so the whole label is a large enough target. The unchecked border and the check mark are drawn by the browser.

### Alert

Variants `info`, `success`, `warning`, `danger`. `danger` is `role="alert"` (assertive) and the others are `role="status"` (polite); the caller may override the role. Meaning never depends on color: each variant has a different inline SVG icon (no external assets, `aria-hidden`) and a visually hidden text prefix.

**Live-region limitation.** Both roles make the element a live region, but assistive technology announces *changes* to a live region after it is mounted, and may not announce content that is already there on first render. For a reliable announcement, mount the alert before the event and then add content, or mount it in response to the event. Screen reader support differs, and an always-visible `role="alert"` can be noisy. This is documented in the component's comments; it is not something the tests can establish.

### Shared pieces

A `dts-visually-hidden` utility class (no colors) is shared by `TextField` and `Alert`. Components import it from `src/visually-hidden.css`. A small internal `mergeRefs` combines the forwarded ref with the checkbox's own ref.

### Forced colors, focus and motion

`TextField`, `Checkbox` and `Alert` (like `Button`) have `@media (forced-colors: active)` rules that keep a border, the mark or the focus ring visible with system color keywords, because background colors are dropped there. Focus rings are `outline` on `:focus-visible`, never `box-shadow`. Tests check this **as CSS text only**: that each stylesheet has a forced-colors block, that text fields and alerts set a border color in it, that no focus rule uses `box-shadow`, and that a transition is switched off for reduced motion. Nobody has rendered it in a browser with forced colors on.

## Alternatives considered

- **A custom-drawn checkbox** (a styled box plus an SVG check, with the input visually hidden). Full control over the unchecked border and the mark, so the 3:1 non-text contrast could be tokenized. Rejected for now: it reimplements states the browser gives for free (focus, forced-colors, indeterminate, high contrast), and each reimplementation is a chance to break accessibility. The cost is that the unchecked border and check mark are not ours to contrast-test.
- **Placeholder as the label, or an optional label with a warning.** Rejected: required prop and type test instead.
- **Showing "required" only with an asterisk,** or announcing the hint as well as the attribute. Rejected: an asterisk alone is not accessible text, and announcing the hint duplicates the attribute.
- **Hard-coded English prefixes.** Rejected for props with defaults; a full i18n layer is out of scope.
- **`aria-live` regions inside TextField to announce errors.** Rejected: automatic announcements are easy to make noisy or inconsistent; the consumer decides how to announce.
- **Auto-generating the contrast registry** from the CSS (reading `color` and `background-color` pairs). Considered; a sound version needs to know which background each element really renders on, which depends on layout and nesting. The explicit registry is simpler and honest about being manual.
- **Role `alert` for every variant.** Rejected: assertive announcements for informational messages are disruptive.

## Consequences

- **The contrast registry is manual.** The tests check the entries that exist, for every theme, and a partial guard checks that every component folder with CSS has at least one entry. **Nothing can notice a pair that was never added.** A reviewer must check that a new component's pairs are registered; the checklist is in CLAUDE.md.
- **jsdom limits still apply.** jsdom has no layout engine and the tests do not load our CSS, so axe there cannot evaluate color-contrast, focus visibility, target size or forced-colors behaviour. Contrast comes from the tokens; the Storybook a11y addon can check it in a real browser, but its results were not reviewed here.
- **Accessibility is partly enforced by API shape, not by tooling.** Because axe accepts placeholder-only inputs, `label` being required is what keeps the rule true.
- **The accessible name of `TextField` excludes the required hint** and the error text, so name-based queries must not include them; the hint's meaning relies on the native attribute being exposed.
- **Live-region announcements are best effort.** Whether an alert is spoken depends on when it is mounted and on the screen reader; none of this is tested.
- **Post-submit errors need consumer work** (focus management or a live region); `TextField` alone will stay silent.
- **The checkbox's unchecked border and check mark are the browser's.** Their contrast follows the browser's defaults and the user's settings and is not covered by the registry; only the accent color is.
- **Strings are English by default.** Consumers in other languages must pass `requiredHint`, `errorPrefix` and `labelPrefix` everywhere; forgetting one leaves English text in a translated UI, and nothing detects that.
- **Roles can be overridden** on `Alert`, which allows a misuse (`role="alert"` on static content) that the library does not prevent.
- **A breaking token change:** `semantic.color.danger` no longer exists as a leaf, so anything that referenced it must use `semantic.color.danger.text` (or the surface or border).
- **More tokens and CSS to maintain:** the exported variables per theme grew from 47 to 120, so the generated CSS file is much larger, and a longer registry.
- **The palette is still a first choice** (blue, green, amber and red status colors chosen for contrast), not validated by a designer, and the icons are simple shapes drawn for this library.
