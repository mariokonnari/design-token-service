# 0011. Tabs and Dialog

- Status: Accepted
- Date: 2026-10-07
- Builds on: [0008](0008-ui-styling-and-theme-generation.md), [0009](0009-form-controls-and-alerts.md), [0010](0010-real-browser-testing.md)

## Context

`packages/ui` gets its first composite widgets: `Tabs` (a roving-tabindex keyboard model) and `Dialog` (a modal). Both depend on browser behavior that jsdom cannot provide, so they are the first components built with the real-browser suite from the start (ADR 0010). Their tokens, contrast pairs and stories follow the existing conventions.

## Decision

### Tokens and contrast

- New `semantic.color.overlay`: `#1a1d21` at alpha 0.5, a literal using the token `alpha` field (semantic tokens may hold literals). It is exported as `rgb(26 29 33 / 0.5)` and is the same in every theme, so the brand overlay (`acme`) does not change it.
- New `component.tabs.*` (text, selected text, indicator color and width, font weights, padding, gap, min-size, panel padding, focus ring) and `component.dialog.*` (surface, text, border, radius, padding, gap, max-width, backdrop = overlay alias, close-button sizing, focus ring), all aliasing semantic tokens except a few literals. Variables per theme went from 120 to 157.
- Contrast ratios, computed before the colors were chosen (WCAG 2.2, against the `#ffffff` surface): tab text 5.74 (4.5 needed); selected tab text 16.91; indicator 5.17 default and 5.70 acme (3 needed); dialog text on the dialog surface 16.91; dialog border on the page surface 3.32 (3 needed); focus ring 5.17 and 5.70. Two extra pairs beyond the request are registered: the close icon and the focus ring on the dialog surface. All run for both themes.
- The overlay is translucent, and the registry needs opaque colors, so it is not registered. `test/overlay.test.ts` checks that it is a color with `0 < alpha < 1`, that the dialog backdrop resolves to it and that the alpha is exported. Alpha 0.5 was chosen over 0.4 and 0.6 because it dims the page enough that the dialog surface stands out from it (3.28:1; 2.48 at 0.4, 4.47 at 0.6). That number is informative, not a requirement.

### Tabs: compound API, not an `items` prop

`Tabs`, `TabList`, `Tab` and `TabPanel` share state through context. A compound API lets consumers put any content in a panel, pass props and refs to every part, and keep tab labels next to their panels in JSX; an `items` array would need render props for every customization. The cost is that consumers must pair `value`s by hand, which a duplicate or missing value can get wrong (documented below).

- Controlled (`value` and `onValueChange`) or uncontrolled (`defaultValue`). Re-selecting the selected tab does not call `onValueChange`.
- **All panels stay mounted and use the `hidden` attribute**, so `aria-controls` always resolves to a real element (an unselected panel that is not in the DOM leaves a dangling reference) and panel state, such as a form's input, survives tab switches. The cost is that every panel's content is rendered and kept in memory even when never shown.
- **Activation:** `automatic` (default) selects as arrow keys move focus; `manual` moves focus only and Enter or Space selects. Automatic is simpler and right when panels are cheap; manual avoids needless work when selecting a tab is expensive.
- **Orientation:** `horizontal` uses Left and Right, `vertical` uses Up and Down; `aria-orientation` is set explicitly; Home and End jump; arrows wrap.
- **Roving tabindex:** the selected tab has `tabindex` 0 and the others -1, so the tab list is one tab stop. The keyboard handler lives on each `Tab` (the focusable element) and not on the non-focusable tablist, which `jsx-a11y/interactive-supports-focus` rightly objects to.
- **Ids** are `useId()` plus `encodeURIComponent(value)`, so two instances never collide and a value such as `"a b"` or `"x/y"` stays a valid id. Values must be unique within one `Tabs`.
- **The selected tab is shown by an indicator and a heavier font weight, never by color alone.** In forced colors, the indicator is `Highlight`.

#### Trade-off: native `disabled` on tabs

Disabled tabs use the native `disabled` attribute, so they are skipped by the keyboard and **not discoverable by screen reader tabbing**. The ARIA tabs pattern allows either that or keeping them focusable with `aria-disabled` so they can be found and explained. We chose native `disabled` because it is the simplest correct behavior: it cannot be activated by click, Enter or Space, and arrow-key skipping needs no extra code. The cost is that a screen reader user may not learn that a disabled tab exists. A consumer who needs the other approach cannot get it from this component today.

#### Trade-off: `tabindex="0"` on every panel

Each panel has `tabindex="0"`, so Tab moves from the selected tab into the visible panel even when the panel has no focusable content (otherwise keyboard users could not reach or scroll the content). **When the panel also contains focusable content, this adds an extra tab stop before it.** The pattern recommends this for panels without focusable content and leaves it to authors otherwise; we apply it everywhere for consistency and do not offer an opt-out in v1.

### Dialog: native `<dialog>` and `showModal()`

We build on the browser's modal dialog rather than a custom focus-trap and portal. The browser gives us the top layer (so no z-index or portal), an inert background, Esc handling and focus restoration to the trigger, and these stay correct as browsers evolve. A custom implementation would reimplement all of that, and each reimplementation is a chance to break accessibility.

- **API:** controlled only (`open`, `onOpenChange`); required `title` rendered as a real heading with `headingLevel` (default 2) and used through `aria-labelledby`; optional `description` through `aria-describedby`; `closeLabel` (default "Close") is the only built-in English string and is a prop; `closeOnBackdropClick` (default true). No portal: it inherits the theme from `ThemeScope`.
- **Syncing:** an effect calls `showModal()` when `open` is true; its cleanup calls `close()`, which covers `open` turning false, unmount and StrictMode's double effects. The native `close` event is asynchronous, so it is reported with `onOpenChange(false)` only if the prop still says open and the element really is closed at that moment; a close we caused is never reported.
- **Esc always closes, and we never `preventDefault` the `cancel` event.** The e2e suite also reopens the dialog after every close path, so any disagreement between React state and the element fails.
- **Backdrop click:** the dialog element has no padding (an inner wrapper has it), so a pointer event whose target is the dialog element is on the backdrop. The press and the release must both be there, so a text selection dragged from inside to the backdrop does not close it. A click on the dialog's 1px border also counts as the backdrop.

#### Deliberate choice and limitation: native Tab behavior

In Chromium, Tab inside a modal dialog cycles through the dialog's controls **plus one stop on the browser UI**, then comes back inside. Headless Chromium has no browser UI, so the extra stop is reported as `document.body`. We do not add a focus trap to remove that stop. What is guaranteed, and tested over 14 presses in each direction: the page behind the dialog never receives focus (it is inert; the trigger and background controls never appear), the only stop outside the dialog is the document or browser UI, there are never two such stops in a row, and focus is back inside within one press. Firefox and Safari order their stops differently and were not tested. A consumer who needs a strict trap must add one.

#### Limitation: initial focus on long content

When the content is taller than the dialog, the inner wrapper scrolls. Chromium makes scrollers without focusable children keyboard-focusable, which is why axe passes `scrollable-region-focusable`, and because the scroller is an ancestor of the close button, **initial focus lands on the scroll container first** (observed in the `LongContent` story). A screen reader user lands on an unnamed region before anything else. Giving the region a role and a name is a possible later improvement; we left it as is for v1. Consumers can control initial focus by putting `autoFocus` on their own child element.

## Alternatives considered

- **`Tabs` with an `items` prop.** Simpler call site, but every customization needs a render prop or an extra prop. Rejected for the compound API.
- **Mounting only the selected panel.** Less DOM, but `aria-controls` would dangle for the unselected tabs and panel state would be lost. Rejected.
- **`aria-disabled` tabs that stay focusable.** Better discoverability; more code (selection must be blocked by hand, and arrow navigation must treat them differently). Rejected for v1 in favor of native `disabled`.
- **A custom dialog with a focus trap and a portal.** Full control over Tab order and initial focus, but it reimplements the top layer, inertness, Esc and focus restoration, and portals lose the theme scope. Rejected.
- **Closing from the `click` event for the backdrop.** `click` fires on the common ancestor of the press and release targets, which makes drag-selection ambiguous; explicit pointer down and up targets are exact.
- **An `open` uncontrolled mode.** Rejected for v1; a consumer wraps state in two lines.

## Consequences

- **Verified only in Chromium (headless, Windows).** All real behavior is covered by `e2e/tabs.spec.ts` and `e2e/dialog.spec.ts` and nothing else. Other engines are unverified: the tab-stop order, whether `::backdrop` inherits custom properties, close-watcher behavior and focus restoration.
- **`::backdrop` and custom properties.** Browsers differ on whether `::backdrop` inherits custom properties from the dialog. Chromium does (verified: `--semantic-color-overlay` resolves on it and the overlay computes to `rgba(26, 29, 33, 0.5)` in both themes). The scanners forbid `var()` fallbacks, so a browser that does not inherit would show no overlay at all; the e2e test guards this for Chromium only.
- **Esc.** The browser handles it. Chromium may need Esc twice when a dialog was opened without any user interaction (an anti-abuse "close watcher" rule); headless Chromium closed an open-from-start dialog on the first press, and real use may differ. A controlled parent that ignores `onOpenChange(false)` leaves state out of sync with the closed element, because the cancel is deliberately not prevented.
- **jsdom has no `showModal` or `close`** (jsdom 30.1.2: the constructor and the `open` attribute exist, the methods do not). The unit tests use a small test double (`test/support/dialogDouble.ts`) that checks props, ARIA wiring and state syncing. It does not simulate the top layer, inertness, focus trapping or restoration, `::backdrop`, Esc or layout; those are e2e only.
- **No scroll lock** on the page behind the dialog, **no nested dialogs**, **no right-to-left key reversal** in tabs, **no overflow or scrolling handling** for long tab lists, and **no animations** in v1.
- **Tabs `value` must match an enabled `Tab`.** Otherwise no tab has `tabindex` 0 and the list cannot be reached with the keyboard. Duplicate values produce duplicate ids. Nothing detects either.
- **The bold selected label widens its tab slightly**, so the other tabs can shift by a few pixels when the selection changes.
- **Screen reader behavior is unverified** for both components: what is announced, and in what order, was not tested.
- **Axe covers text contrast for every story** (including the open dialog, with `color-contrast` actually evaluated); non-text pairs stay in the registry. The overlay alpha is checked by a token test and in the browser (alpha strictly between 0 and 1).
- **Proof the tests can fail** (each breakage applied, Storybook rebuilt, the matching spec confirmed red, the file restored and its hash verified): removing the roving tabindex failed 6 e2e tests; reversing Home and End failed 2; making the overlay alpha 0 failed 2 e2e and 4 unit tests; `preventDefault` on `cancel` failed 6 e2e and 1 unit test; closing on any pointer release failed 6 e2e and 5 unit tests. Focus restoration and the inert background are native and cannot be broken from our code, so the Esc and close wiring was broken instead.
