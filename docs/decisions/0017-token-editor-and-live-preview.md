# 0017. The token editor and live preview

- Status: Accepted
- Date: 2026-10-14
- Builds on: [0014](0014-brands-and-draft-tokens.md), [0015](0015-releases-and-public-api.md), [0016](0016-web-app-foundation.md), [0011](0011-tabs-and-dialog.md)

## Context

Phase 4a gave `apps/web` sign-in, organizations and brands, with a placeholder at `/orgs/:orgId/brands/:brandId`. The API already had per-token draft CRUD with optimistic concurrency, a read-only `/validate` and a replace-only import (ADR 0014). Phase 4b turns the placeholder into the **Theme Editor**: list, edit and delete draft tokens, check them with the server, and watch them live against the `@dts/ui` components. **No API change was needed** (the only API edit is internal, the mapper below).

## Decision

### The screen

`BrandPage` keeps the 4a guards (unknown and foreign brands are the same "not found", ADR 0016) and renders `components/editor/Editor.tsx`:

- a header (slug, visibility, your role, draft revision) and the **library coverage** line;
- left column (a `role="group"` named "Tokens and editing"): search, one **tab per tier with counts** (`Tabs`, ADR 0011), the list of the selected tier grouped by the first two path segments, the panel of the selected token, and the **draft check**;
- right column (stacked on narrow screens): the **live preview** inside `<ThemeScope theme="preview">`.

Every tier's `TabPanel` **stays mounted** (so `aria-controls` always resolves) and list content is rendered **only inside the selected panel**; the others are empty. A test pins both halves.

Each list row is a button showing the path, the type and the value **as text**, plus a decorative swatch (`aria-hidden`; its colour is the *resolved* colour, so an alias shows its target's). The selected row has a thicker border and bold text (never colour alone). Roles: OWNER and EDITOR edit; a **Viewer** sees values as text, no inputs, no Create, Save, Delete or Import, and an explanation, but may still run the draft check (a read).

### The selected token is `?token=<path>`, and that value is never trusted

Deep links (from the draft check, reload) address a token through the URL, so the value is attacker-controlled. `parseTokenParam` accepts only a plain token path: at most 200 characters (checked **before** any pattern runs), valid name segments, and none of `__proto__`, `constructor`, `prototype`. Everything else (a 10 KB string, control characters, slashes, encoded slashes `a%2Fb`, markup, `..`) is `invalid`, and so is a valid path that is not in the draft: both show the same calm **"Token not found"** panel with a "Show all tokens" link, **without echoing the value**. The value is only ever compared as text (a `Map` lookup), never used as an object key, put in a URL without encoding, or rendered as markup. Unit tests cover each hostile class; the browser suite loads six of them and asserts no page error, no dialog and no injected element.

### One edit at a time; "Discard changes?" is our Dialog

The overlay data structure (`workingCopy.ts`: `edit | add | delete` keyed by path) allows many unsaved edits; **the UI uses at most one**. Choosing another token, or Create, while the form is dirty opens a **"Discard changes?"** `Dialog` (never `window.confirm`: a native confirm cannot be styled, tested in jsdom or themed). Keep editing / Discard changes. Cancel in the form reverts without a prompt (it is explicit).

**Leaving the page with unsaved edits is NOT guarded in v1**: browser Back/Forward, a link to another page, a reload and closing the tab all drop the edits silently. The prompt covers only in-app selection changes. A `beforeunload` guard and a router blocker were left out (the first is hostile and unreliable, the second needs the data router, ADR 0016); the gap is the price of keeping the declarative router.

### Saving never overwrites silently

One `PUT` per Save, with the `expectedVersion` the token was loaded with (omitted when creating). On a **409 `VERSION_CONFLICT` / `VERSION_REQUIRED`** the list is reloaded, **what was typed stays in the form**, the **latest saved value** is shown in a warning Alert, and Save is replaced by an explicit second click, **"Save over their version"** (which sends the *fresh* version), next to "Use their version". A token deleted meanwhile (`currentVersion: null`) offers **"Create it again"** (no version). `PATH_CONFLICT` becomes an error on the path field naming the other token; `TOKEN_LIMIT`, import `REVISION_CONFLICT`, 400 issues (mapped to fields), 429 and 503 have their own wording (`describeTokenError`, pure, tested; server sentences are never passed through, except the issue messages of a 400, as React text). Errors after a failed save move focus to a summary (as in 4a).

After a write the cache is updated from the response (`withSavedToken`/`withoutToken`, pure) and the revision on the brand follows. A save returns focus to the panel heading, a create to the new token's heading, a delete to the **list heading**, and the live region announces ("Saved primitive.color.x, revision 12").

### Delete

A confirmation `Dialog`, then `DELETE ...?expectedVersion=N` (the version travels in the query: a DELETE body has no defined semantics). A stale version is explained, not forced. **Finding (real browser only):** the first version focused the list heading right after the request, and e2e showed the focus ending nowhere: closing a native `<dialog>` hands focus back to the button that opened it, and with the router's transition the panel is removed *after* that. The focus now moves in an effect, once the selection is gone (jsdom cannot show this; the browser spec asserts it).

### Value editors are pure parse/format pairs

`editor/values/*.ts` return `{ ok, value } | { ok: false, message }` and never throw: colour (**hex field + a separate alpha 0..1 field**; `#rrggbb` and `#rgb`, `#rrggbbaa` is refused; the **components stay the source of truth**, so an unchanged hex keeps the original unrounded components and the `hex` fallback key is never written), dimension (`px`/`rem`, decimal), font family (a comma list with `"…"`/`'…'` quoting and `\"` escapes; empty entries, unbalanced quotes and text after a closing quote are refused; the formatter quotes only names that need it), font weight (1..1000 or a DTCG name), number (decimal only) and alias (`{path}` or the bare path; **a text field with live validation, not a picker**: 2000 options is heavy and a picker is more UI than asked). Inputs are capped at 2000 characters and refuse control characters before any pattern touches them. Tests: round trips, and hostile input (`1e999`, `NaN`, control characters, quotes, `__proto__`, 10 KB strings).

`form.ts` turns the strings into a tokens-core `Token` (or one message per field) and applies the same `validateLiteral` the server runs.

### Local checks say "looks valid here", never "publishable"

`validateLocal` checks the working copy for instant feedback: the tiers, "a token cannot also be a group", duplicate paths on create, the 2000-token limit, and alias targets and cycles through `resolve` and `checkTiers`. Its wording is **"Looks valid here"**; only the server's `/validate` ever says "publishable". Local problems do **not** block Save (a draft may be invalid, ADR 0012); they are field messages plus a note that the draft check says what must change.

### The draft check

"Check draft" calls `GET /validate`; the result is a list in which each issue links to `?token=<path>` **only when the path is a plain token path** (otherwise it is plain text), announced politely ("Draft check: 1 error, 1 warning" / "publishable"), with **"Checked at revision N"** (and the current revision when it differs) so staleness is visible. It also runs once, **1.5 s after the last successful write** (debounced by a timer cleared on the next write; a manual check is always available).

### Library coverage (the gap publishing does not close)

The component library has **no `var()` fallbacks** (ADR 0008): a variable that a brand's draft does not define is simply unset in the published CSS and the component loses that style. Nothing in publishing prevents that. The editor shows **"Library tokens defined: N of M"** in the header, where M is the number of semantic and component paths in the starter template (`default.tokens.json`, exported from `@dts/ui` as `./tokens/default.tokens.json`) and N how many of them the draft defines, computed by the pure `libraryCoverage(tokens, starterTokens)` (a set difference on paths; it judges no values). A button lists the missing paths on demand (an accessible disclosure with `aria-expanded`, text, not colour).

**Gap, recorded:** `validateDraft` and `publish` do **not** enforce coverage, and unthemed library CSS has no fallbacks. An **optional coverage rule in `validateDraft`** is on the Phase 5 backlog (CLAUDE.md), together with the contrast gate.

### The live preview

`buildPreviewCss(tokens)` = tokens-core `resolve` + `toCssVariables` (the **same exporter that publishes**), scoped to `[data-theme="preview"]`, semantic and component tiers only; a token that fails to resolve is omitted, so the **cascade falls back to the surrounding default theme** (the `data-theme="preview"` element inherits every variable it does not declare). `applyPreviewStyle` keeps **one** `<style data-dts-preview>` in `<head>` and writes `textContent` only; output containing `<` is refused (the exporter already escapes it: a second wall). ESLint forbids `innerHTML` in `apps/web`, a source scan repeats it, and the mutation table shows both catch it. The gallery shows `Button`, `TextField`, `Select`, `Checkbox`, `Alert` (four variants), `Tabs` and a `Dialog` with its trigger, labelled "This preview shows @dts/ui components only." The editor chrome stays in the default theme.

The preview is computed from `useDeferredValue(workingCopy)`: **measured** (`resolve + toCssVariables`, 1000 primitive colours + 500 semantic + 500 component aliases = 2000 tokens, 20 runs, Node/jsdom on the 4-core Windows development machine): median **10.5 to 10.8 ms**, worst **20 to 23 ms** over three runs. The test asserts only a generous bound (median < 500 ms); no debounce was needed. CI machines differ.

### Shared row mapper (tokens-core)

The row <-> token rules moved from `apps/api/src/tokens/mapper.ts` to tokens-core (`tokenFromParts` -> `{ ok, token, warnings } | { ok: false, message }`, `tokenToParts`), so the browser reads a stored token exactly as the server does. The API keeps `rowToToken`/`tokenToRow` as a thin wrapper that turns a failure into `UNMAPPABLE_ROW` (that code, `EMPTY_DRAFT` and `RULE_FAILED` stay API-local, so `ISSUE_CODES` did not change). **The existing API mapper tests (`mapper.test.ts`, 295 tests across the token suites) pass unchanged.** The moved cases plus alias and hostile ones live in `packages/tokens-core/src/rows.test.ts`. A web test pins that tokens-core imports no Node module (it already ran in the browser for `isValidName`; now it runs `resolve` and `toCssVariables` there).

### `Select` in `@dts/ui`

A native `<select>` with a required label, description and error wired as in `TextField`, `aria-invalid` only while there is an error, overridable `requiredHint`/`errorPrefix`, ref as a prop, outline focus ring, a forced-colors rule and a 36 px minimum size (in `MIN_SIZE_TOKENS`). The native arrow and popup are kept (`appearance: auto`): no custom dropdown, so keyboard, screen reader and forced-colors behaviour stay the platform's. **Component tokens only** (`component.select.*`, 24 tokens aliasing the same semantic tokens as `textfield`; no new semantic token). Because the aliases are identical, the contrast ratios are identical to `TextField`'s (text 16.91, description 5.74, error 10.02, border 3.32, invalid border 6.47, focus ring 5.17 default / 5.70 acme); every pair is registered. The Storybook axe run needed one allowance: `components-select--disabled` joined `components-textfield--disabled` in the "all text belongs to a disabled control" list (axe reports contrast as not applicable there; the spec still asserts zero evaluated nodes).

### Other

- **`client.ts`** gained `put` and `del`; `endpoints.ts` the five token calls (`listTokens`, `putToken`, `deleteToken`, `validateDraft`, `importTokens`), bodies rebuilt from named fields (no `expectedVersion` key when creating), ids and paths URL-encoded. Hand-written types still can drift (ADR 0016).
- **Local copy of four server limits** (path 200, value 8192 bytes of JSON, description 500, 2000 tokens) in `editor/limits.ts`; the server stays authoritative, so drift costs a server 400, not wrong data. The input caps of the editors keep every value they can produce far below 8192 bytes (a test pins the worst inputs).
- **`assertFreshDist`** now also watches `packages/ui/tokens` (the starter JSON is bundled into the app).
- **The Viewer e2e helper** (`e2e/support/viewer.ts`) is the only place the web suite writes to the database directly (there is no invitation API). It adds a membership for a user who already signed up. It **refuses to run unless the database name ends in `_test`**, with the API tests' own guard (`assertTestDatabase`): once on the URL **before any connection is opened**, and again on `current_database()` before the `INSERT`; the statement uses parameters only and never creates a user. `test/e2eViewerHelper.test.ts` proves both refusals (a development name, a production-looking name, `dts_test_backup`, an encoded path trick, upper case, no URL at all, a live connection to the wrong database; nothing is written and the connection is closed) and that the password is never echoed. `playwright.config.ts` and the helper now share one `e2eDatabaseUrl`. `pg` and `@types/pg` (both resolved to 8.23.1, the API's ranges) are `devDependencies` of `apps/web` for this helper only; no package reported an ignored build script.

## Alternatives considered

- **`window.confirm` for the discard prompt.** Unstyled, untestable in jsdom, and not themed. The `Dialog` exists.
- **Keep several unsaved edits** (an overlay per token). More state to lose and to explain; one dirty token keeps the model small. The data structure allows it later.
- **A picker for aliases.** 2000 options, more UI than asked, and typing a path is faster for the people who know it.
- **Silent last-write-wins on a conflict**, or auto-merge. Either loses someone's work without telling them.
- **`#rrggbbaa` in the colour field.** Two ways to write alpha; a separate field keeps the hex strictly 6 digits.
- **Adopted stylesheets** (`document.adoptedStyleSheets`) instead of a `<style>` element for the preview: see the CSP note.
- **Debouncing the preview.** Not needed at the measured cost; `useDeferredValue` keeps typing responsive.

## Consequences and honest gaps

- **Unsaved edits are lost on leaving the page** (Back, a link out, reload, closing the tab). Only in-app selection changes are guarded.
- **No real-time collaboration, no undo/redo** (history is releases, ADR 0015), **no bulk edit, drag and drop, rename or move of a token** (a path is fixed after create), **no dark-mode preview**, **sRGB only**, the **preview shows `@dts/ui` components only**, **English only**.
- **The contrast gate comes in Phase 5.** A person's own low-contrast colours will fail real contrast inside the preview by construction; the editor shows the colours, it does not judge them. The browser axe run uses the default starter values.
- **Publishing does not enforce library coverage**; unthemed library CSS has no fallbacks (above). Phase 5 backlog: an optional coverage rule in `validateDraft`.
- **CSP for Phase 6.** The preview writes a `<style>` element, which a strict `style-src` would block: it needs a nonce or `'unsafe-inline'`. Adopted stylesheets avoid that and are the likely replacement if a nonce is not wanted. Not verifiable until there is a deployment.
- **Axe cannot decide the contrast of wrapped text inside a modal dialog on this page** (it reports "could not decide" with `elmPartiallyObscuring`; a one-line description passes, a two-line one does not, in any dialog on the editor page, while the same `Dialog` passes in Storybook; screenshots show correct rendering). Not root-caused. Mitigations, not a weakened check: the dialog copy is kept to one short line, and the dialog states are checked with axe scoped to `dialog[open]` (the page behind a modal is inert). The tokens still pass the registry (`component.dialog.text` on `component.dialog.bg`).
- **The Viewer experience in e2e depends on a direct database write** (above) until members exist in the API.
- **Chromium only; no screen reader; no hover or active states.** Forced colours are checked for the borders of the panels and the list and for the focus outline of a list item, not for every control. The top layer, focus return and the cascade fallback are covered only in the browser suite.
- **`Select` is native.** Its popup follows the operating system and cannot be themed beyond the closed control.
- **Local checks do not re-check other tokens** that point at the edited one (changing a token's type can break an alias elsewhere); the draft check finds those.
- **Hand-written API types can drift** (ADR 0016); the endpoint tests and the editor e2e are the only guard.

## Tests, and proof that they can fail

Written before the code and run red (the shared mapper, the web logic, the page, the Viewer helper and `Select` each had a red run). Mutations applied to the real code, tests run, file restored with its sha256 verified, strictly sequential:

| Mutation | web unit | web e2e (`editor.spec`, 30) |
|---|---|---|
| (a) the preview stops injecting its style | 2 fail | 3 fail |
| (a) the preview ignores alias resolution | 7 fail | 3 fail |
| (b) Save omits `expectedVersion` | 2 fail | 6 fail |
| (c) a Viewer is treated as an editor | 2 fail | 1 fail |
| (d) delete without a confirmation | 3 fail | 3 fail |
| (e) the preview CSS is injected with `innerHTML` | 1 fail (source scan) | n/a; **ESLint reports 1 error** |
| (f) `Select` loses its label wiring | 9 unit fail (`@dts/ui`) | 14 axe fail (Storybook) |
| the Viewer helper stops checking the URL | 7 fail | n/a |
| the Viewer helper stops checking `current_database()` | 1 fail | n/a |
| `?token=` accepts reserved names | 4 fail | n/a |
| library coverage counts primitives too | 3 fail | n/a |
| the discard prompt is skipped | 1 fail | n/a |

One caveat from the runs: in one full web unit run under the library-coverage mutation, 7 test files failed to *load* (no individual failure text was kept); the next full run under the same mutation showed exactly the 3 expected failures, and the 7 files pass alone. It was not reproduced and not explained (a transient environment failure is the likely cause).
