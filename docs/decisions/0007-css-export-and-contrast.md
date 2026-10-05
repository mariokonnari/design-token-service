# 0007. CSS export, JSON export and contrast

- Status: Accepted
- Date: 2026-10-05
- Builds on: [0002](0002-token-model-and-theming.md), [0006](0006-token-subset-and-tier-rules.md)

## Context

ADR 0002 chose CSS custom properties scoped to a wrapper element as the theming mechanism. Phase 1b implements the export side in `packages/tokens-core`: turning resolved tokens into CSS and JSON, plus the color utilities an editor needs to check accessibility.

Three things make this more than string formatting:

- Token data is tenant-supplied, and some of it (font family names) ends up inside CSS that will be served to other people's browsers, possibly inside an HTML `<style>` element. The exporter is a trust boundary.
- Token paths become CSS variable names, and the name mapping (`.` to `-`) is not injective.
- Contrast checks need exact, reproducible color math.

Sources read while implementing (not recalled from memory):

- DTCG Format Module 2025.10, section 8.4, for the font weight table.
- WCAG 2.2, the definition of "relative luminance" (sRGB threshold 0.04045; the text notes it was 0.03928 before May 2021 with no practical effect) and "contrast ratio".
- CSS Fonts Level 4 (a W3C *Working Draft*) for font family syntax and the generic family keywords; CSS Values 4 and CSS Cascade 5 for the CSS-wide keywords.

## Decision

### Export resolved literals, not `var()` chains

`toCssVariables()` writes each token's final value (`--semantic-action: #2563eb;`), computed from the resolved literal. It does not write `--semantic-action: var(--primitive-color-blue-500);`.

### Scope comes from a validated slug, never from a selector string

`{ kind: 'root' }` produces `:root`. `{ kind: 'attribute', name: 'data-theme', value: slug }` produces `[data-theme="<slug>"]`, and only when `slug` passes the existing name rules (`^[a-z0-9]+(-[a-z0-9]+)*$`) and `name` is exactly `data-theme`. There is no option that accepts a raw selector. The checks run at runtime as well, because callers can pass JSON that bypasses the types; an invalid scope returns `INVALID_VALUE` and no CSS.

### Detect name collisions instead of inventing a separator scheme

`a.b-c` and `a-b.c` both map to `--a-b-c`. Strict names do not prevent this (this corrects an implication in ADR 0006). The exporter groups tokens by variable name after filtering; every token in a colliding group gets `CSS_NAME_COLLISION` with all the colliding paths in `related`, and none of them is exported, so the output never silently depends on which one "wins". The other tokens are still exported.

### The exporter does not trust its input

Even though `flatten()` already validates, `toCssVariables()` re-checks everything that reaches the output: every path segment must be a valid name (`INVALID_NAME`), the token type must be supported (`INVALID_TYPE`), the value is run through `validateLiteral` again (`INVALID_VALUE`), and duplicate paths are `PATH_CONFLICT`. A token that fails is omitted with an issue. The exporter's safety therefore does not depend on callers having used `flatten()`.

### Value serialization

- **color**: computed from the components (the source of truth), not from the optional `hex` fallback. 8-bit rounding. Alpha is rounded to three decimals; if that is 1 (or alpha is absent) the output is `#rrggbb`, otherwise `rgb(r g b / a)`.
- **dimension**: `${value}${unit}`. **number**: the plain JavaScript number text (which may use exponent notation, for example `1e-7` or `1e+21`, valid in CSS).
- **fontWeight**: always a number. DTCG names are converted with the 2025.10 table (`bold` is 700, `extra-black` is 950). The JSON export keeps names as written.
- **fontFamily**: generic family keywords (`serif`, `sans-serif`, `system-ui`, `cursive`, `fantasy`, `math`, `monospace`, `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`) are matched case-insensitively and written unquoted in lower case. A name that is a single ASCII identifier with at most one leading hyphen (`^-?[A-Za-z_][A-Za-z0-9_-]*$`) is unquoted, which keeps vendor keywords such as `-apple-system` readable, unless it is a CSS-wide keyword or reserved (`initial`, `inherit`, `unset`, `revert`, `revert-layer`, `default`, plus `emoji` and `fangsong`). Everything else is double-quoted: names with spaces or digits at the start, names starting with `--`, and all non-ASCII names.

### Escaping and rejection rules (the security rules)

- Inside quotes: `\` becomes `\\`, `"` becomes `\"`, and `<` becomes `\3c ` (with the terminating space), so `</style>` and `<!--` can never appear in the output. Control characters, if one ever reached the serializer, are written as hex escapes.
- At validation time, a font family string that contains an ASCII control character (U+0000 to U+001F, U+007F) or a lone UTF-16 surrogate is rejected with `INVALID_VALUE` (field `$value` or `$value[i]`). Valid surrogate pairs and other non-ASCII text are allowed, so output is always well-formed Unicode.
- Everything outside quotes is built only from validated names and slugs, numbers, units and fixed keywords, so no other character can appear there.
- Output has no comments (descriptions are never emitted) and exactly one declaration per line.

### JSON export

`toResolvedTree()` builds a nested DTCG-shaped tree of literal tokens only (no aliases) with `nest()`, so it has the same ordering and issues (`INVALID_NAME`, `PATH_CONFLICT`).

### Color utilities and contrast

`parseHex`, `toHex`, `relativeLuminance`, `contrastRatio` and `flattenAlpha` implement WCAG 2.x for opaque sRGB colors. `flattenAlpha` composites a translucent color over an opaque background per channel in gamma-encoded sRGB (the usual convention for contrast checkers), and `contrastRatio` is exactly symmetric and always within [1, 21]. Only WCAG 2.x is implemented.

### How the security rules are verified

1. **Exact-output unit tests** for hostile inputs such as `Arial"; } body { display:none } /*` and `</style><script>`.
2. **A hand-written scanner** (test-only) that requires exactly the promised shape (one selector line, one declaration per line, closing brace) and scans values with a quote- and escape-aware state machine: no `{`, `}`, `;`, `<`, `>`, backslash or comment delimiter outside quotes, no unterminated string, and no `<` anywhere.
3. **An independent parser oracle**, `css-tree` (test-only devDependency, 3.2.1, with `@types/css-tree` 3.2.0), run with its custom-property parsing enabled. For every hostile case and in a property test over arbitrary font strings it asserts: no parse errors, no comments, no at-rules, exactly one rule, exactly the expected number of declarations with the expected variable names, and that font-family, color, dimension and font-weight values match the real CSS grammar of those properties.
4. **A property test** over arbitrary strings (including random UTF-16 and punctuation-heavy text) asserting the exporter either rejects the value with an issue or produces output that passes both checkers.
5. **Both checkers are shown to be able to fail**: tests feed them deliberately broken output (a break-out written inside a custom-property value, a second declaration smuggled onto the line, a declaration closed early, an unterminated string, braces and a comment inside a value) and assert they are flagged. Mutation checks on the exporter (dropping the `<`, `"` or `\` escape, the slug check, the path check) each made tests fail.

## Alternatives considered

- **`var()` chains** (`--semantic-action: var(--primitive-color-blue-500)`). Keeps the cascade live, so overriding a primitive at runtime would restyle everything built on it. Rejected: the editor previews and exports resolved values, a chain makes each tenant's CSS depend on tokens that may not be exported (`include`), and cycles or missing variables fail silently in CSS. See Consequences.
- **A separator scheme to avoid collisions** (for example `--a__b-c` for `.` and `-`). Rejected: it makes every variable name uglier and still does not protect against every pair of inputs, while detection is simple and explicit.
- **Silently let the last token win on a collision.** Rejected: the result would depend on input order.
- **Accept a selector string for the scope.** Rejected: the slug is the only caller-controlled text that reaches a selector, and it has a tiny allowed alphabet.
- **Escape control characters instead of rejecting them.** Considered; rejecting is simpler to reason about and the serializer still hex-escapes them as a second line of defence.
- **postcss as the oracle.** Rejected in favour of css-tree because css-tree also validates values against the CSS grammar (via mdn-data), not just structure.
- **APCA instead of WCAG 2.x.** Not a standard yet; WCAG 2.x is what accessibility requirements reference today.
- **A browser-based check** (for example a headless browser parsing the output). Not done; see the limits below.

## Consequences

- **No runtime cascade from primitives.** Because values are resolved, changing a primitive requires re-exporting the CSS; an override of `--primitive-color-blue-500` in the browser does not affect `--semantic-action`. This trades flexibility for predictable, self-contained output.
- **Colors lose precision.** Output is 8-bit and alpha is rounded to three decimals, so a CSS color can differ from the stored components by up to half a step per channel, and an alpha such as 0.9996 is exported as opaque.
- **The default `include` exports everything**, including primitives and tokens outside any tier, which exposes primitive naming to consumers. Pass `include` to export only the tiers a UI should see.
- **Generic family handling is based on a Working Draft.** A font literally named `serif` (or any generic keyword) cannot be expressed, because it becomes the generic family. The functional `generic(...)` forms are not supported, and `emoji`/`fangsong` are quoted rather than treated as generics. Quoting extra names is safe; missing a reserved keyword would not be, so the list is deliberately generous.
- **Contrast limits.** WCAG 2.x ratios have known perceptual weaknesses (notably for dark themes and some hue pairs), APCA is not implemented, and only the ratio is computed: no large-text thresholds or pass/fail levels. Blending translucent colors in gamma-encoded sRGB is the conventional approximation, not a physical model, and a translucent color over a gradient or image cannot be evaluated at all.
- **Only sRGB.** Other color spaces are rejected earlier (ADR 0006), so the exporter never has to convert.
- **The guarantee has a defined scope.** It covers the exporter's output when placed in a stylesheet or an HTML `<style>` element. It is verified by two independent checkers (the css-tree parser and the hand-written scanner) plus unit and property tests, **not by a browser run**. It says nothing about other contexts: embedding the CSS in a JavaScript string, in an HTML attribute, or in a context with its own escaping needs that context's escaping on top. It also does not cover what consumers do with token values elsewhere.
- **What the parser oracle can and cannot see** (observed while building it):
  - By default css-tree keeps the value of a custom property (`--x: ...`) as opaque `Raw` text, so a break-out inside such a value would be invisible. With `parseCustomProperty` enabled it parses values into nodes and can see inside them; a test pins that difference.
  - With that option the parser did flag every break-out sample we wrote, including one placed inside a `--x:` value (through a second rule, a smuggled declaration, parse errors, or comments), and it flags unterminated strings and braces inside a value as parse errors with a `Raw` value.
  - It cannot see HTML-level break-outs. `"</style><script>"` inside a quoted string is valid, harmless CSS to it, so a test records that the parser accepts it. The `<` escape and the "no `<` anywhere" rule are therefore protected by the scanner and the exact-output tests, not by the parser.
  - css-tree is tolerant by design; the assertions rely on structure counts and on `onParseError` being empty, not on the parser rejecting input.
- **The scanner is hand-written and encodes our own format**, so a bug that the scanner and the exporter share is possible; that is why a second, independent checker exists.
- **Output ordering depends on `comparePaths`**, so numeric segments sort numerically (`--k-2` before `--k-10`).
- **The exporter re-validates**, which costs a little time per token and means callers who built `ResolvedToken` objects by hand get issues rather than output for malformed values.
- **css-tree is a devDependency only.** `tokens-core` still has zero runtime dependencies; the test-only helpers that import it live outside `src` (`packages/tokens-core/test`).
