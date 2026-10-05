# 0006. Token subset, strict names and tier rules

- Status: Accepted
- Date: 2026-10-05
- Refines: [0002](0002-token-model-and-theming.md)

## Context

[ADR 0002](0002-token-model-and-theming.md) chose DTCG-style JSON targeting spec version 2025.10 "with a documented subset" and three tiers. Phase 1a implements that in `packages/tokens-core`, which forces the details to be decided:

- Which parts of the Format and Color modules are supported, and what happens to input outside that.
- How token names relate to CSS custom property names.
- What a tier rule actually permits. The wording in ADR 0002 and CLAUDE.md ("each tier references only the tier below it", "components consume only semantic tokens") is wrong or ambiguous: the intent is that **UI components** never use primitive tokens, while **component-tier tokens** are an ordinary part of the model that may alias semantic or other component tokens.

The DTCG 2025.10 text was read directly while implementing this. Points worth recording:

- A token's type is its own `$type`; otherwise, if its value is a reference, the target's type; otherwise the closest group `$type` (Format module section 5.2.2). Section 6.7.3 lists the precedence without the reference step, so the spec is slightly inconsistent. We follow section 5.2.2.
- The spec says tools MUST support JSON Pointer `$ref`, property-level references inside values, the `$root` token name, group `$extends` and the Resolver module.
- The Color module allows 14 color spaces, the keyword `"none"` in components, and an optional 6-digit `hex` fallback.

## Decision

### This is a documented subset, not a conforming implementation

`tokens-core` implements a **subset** of DTCG 2025.10. It is **not a conforming implementation**: the spec requires JSON Pointer `$ref` support and we do not provide it. Input that is valid DTCG but outside the subset is reported with an issue, never silently accepted or crashed on.

| Area | Supported | Not supported (reported as) |
| --- | --- | --- |
| Types | `color`, `dimension`, `fontFamily`, `fontWeight`, `number` | `duration`, `cubicBezier`, `strokeStyle`, `border`, `transition`, `shadow`, `gradient`, `typography` (`UNSUPPORTED_TYPE`); any other `$type` (`INVALID_TYPE`) |
| Color | `colorSpace: "srgb"`, three components in [0, 1], optional `alpha` in [0, 1], optional 6-digit `hex` | The other 13 spec color spaces (`UNSUPPORTED_COLOR_SPACE`); `"none"` components and property-level `$ref` (`UNSUPPORTED_FEATURE`) |
| Dimension | `{ value, unit }` with `px` or `rem` | other units (`INVALID_VALUE`) |
| fontFamily | a name or a non-empty array of names | references inside the array (`UNSUPPORTED_FEATURE`) |
| fontWeight | a number in [1, 1000] or one of the 18 named weights (case-sensitive, kept as written) | anything else (`INVALID_VALUE`) |
| number | any finite number | |
| References | curly-brace aliases `{a.b.c}` to a token | JSON Pointer `$ref` (`UNSUPPORTED_FEATURE`) |
| Structure | nested groups, group `$type` inheritance, token `$description` | `$extends`, `$root` (`UNSUPPORTED_FEATURE`, errors); `$deprecated`, `$extensions`, unknown `$` properties (ignored, `UNSUPPORTED_FEATURE` warnings); the Resolver module and modes |

Group `$description` is accepted and dropped. Empty groups are dropped. Both are lossy by design: the model is flat tokens, not a faithful document.

### Strict names

Every path segment must match `^[a-z0-9]+(-[a-z0-9]+)*$`. This is deliberately stricter than the spec (which allows nearly anything except a leading `$` and the characters `{ } .`), because names become CSS custom property names and export keys. DTCG's own examples ("Hot pink", "token name") are therefore `INVALID_NAME` here. Paths are dotted strings; segments never contain a dot.

### Flat model

`flatten()` turns a nested tree into a sorted list of tokens; `nest()` is the inverse. A token is a validated literal (`type` + typed `value`) or an alias (`alias` path plus an optional declared `type`). Paths sort with numeric segments first and numerically (`100`, `500`, `1000`, then other names), which is also the order JS uses for object keys, so `flatten` and `nest` agree on order.

Type rules: an explicit `$type` wins; a literal without one inherits the closest group `$type`; an **alias takes its target's type and ignores the group `$type`** (section 5.2.2), and an explicit `$type` on an alias must equal the target's type (`TYPE_MISMATCH`).

### Rejected tokens and alias errors

`flatten()` omits tokens it cannot represent and returns their paths as `rejected`. `resolve()` accepts that list; an alias to a rejected path gets `ALIAS_TARGET_INVALID` (pointing at the target's own issue) instead of a misleading `ALIAS_NOT_FOUND`. `ALIAS_TARGET_INVALID` is also used for an alias whose target exists but failed to resolve (for example after a type mismatch). An error on a token drops that token; errors on groups (such as `$extends`) do not drop their children.

### Issues

Issues are values: `{ code, severity, path, message, field?, related? }`. `path` is the token or group path (`''` for the root); `field` names the exact input at fault (for example `$value.components[1]`) so an editor can highlight it. Nothing throws on bad user input. The 15 codes:

`INVALID_NAME`, `INVALID_TYPE`, `MISSING_TYPE`, `UNSUPPORTED_TYPE`, `UNSUPPORTED_COLOR_SPACE`, `UNSUPPORTED_FEATURE`, `INVALID_STRUCTURE`, `INVALID_VALUE`, `HEX_MISMATCH`, `PATH_CONFLICT`, `ALIAS_NOT_FOUND`, `ALIAS_TARGET_INVALID`, `ALIAS_CYCLE`, `TYPE_MISMATCH`, `TIER_VIOLATION`.

Convention: valid DTCG outside the subset is `UNSUPPORTED_*`; input that violates the spec is `INVALID_*`. `HEX_MISMATCH` is a warning: it fires when `hex` differs from the components by more than **one 8-bit step in any channel** (so a component of 0.5 may be written `#7f` or `#80`).

### Alias resolution

Iterative depth-first search with an explicit stack and a memo, so a very long chain cannot overflow the call stack and diamond-shaped graphs are not mistaken for cycles. Every member of a cycle gets an `ALIAS_CYCLE` issue naming the full cycle, and tokens that depend on a cycle are reported too. Output and issues are sorted by path and do not depend on input order.

### Tier rules

Top-level groups are `primitive`, `semantic` and `component`; a token must live inside one of them.

- **Primitive** tokens are literals only.
- **Semantic** tokens may alias primitive or semantic tokens.
- **Component** tokens may alias semantic or component tokens.
- **UI components never reference primitive tokens; they use semantic and component tokens.**

This replaces "components consume only semantic tokens" from ADR 0002. `checkTiers()` checks direct alias edges only, is independent of `resolve()`, and does not need the target to exist.

**Policy:** semantic and component tokens may also hold literal values. The rule above only restricts what an alias may point at. This is a policy choice, not a spec requirement, and it **may tighten later** (for example to require semantic tokens to be aliases).

## Alternatives considered

- **Conform to the full spec** (JSON Pointer `$ref`, `$extends`, `$root`, all color spaces, the Resolver module). Rejected for this phase: large surface, and several parts (color-space conversion, modes) are not needed for the first editor. The subset can grow behind the same issue mechanism.
- **Use the spec's name rules.** Rejected: names would need a second, lossy mapping to CSS identifiers and would invite collisions (for example case-only differences).
- **Keep the nested tree as the model.** Rejected: aliases, validation and exporters are simpler on a flat, sorted list, and the tree is easy to regenerate.
- **Throw on invalid input.** Rejected: a multi-tenant editor needs every problem at once, with locations, not the first exception.
- **Silently drop invalid tokens and let aliases report "not found".** Rejected: it points users at the wrong problem. Hence `rejected` and `ALIAS_TARGET_INVALID`.
- **Hold every non-primitive token to aliases only.** Rejected for now: it blocks legitimate one-off values and was not requested. Left as a possible future tightening.
- **Exact hex comparison.** Rejected: legitimate tools round halves differently (0.5 becomes `#7f` or `#80`), so an exact check would warn on correct input.

## Consequences

- We are a subset. Tenant data authored in other DTCG tools may use `$ref`, `$extends`, other color spaces or `"none"` and will be reported, not imported. Anything stored today could need migration if the subset grows or the spec changes (the Color and Resolver modules are still open questions from ADR 0002).
- The strict name rule rejects some valid DTCG documents (spaces, capitals, underscores). Import tooling will have to rename or reject them.
- `flatten()` is lossy: group descriptions, `$deprecated`, `$extensions`, empty groups and group-level `$type` are not preserved, so `nest(flatten(tree))` reproduces a tree only in canonical form (explicit `$type` on every token). Round trips are guaranteed at the token level, not the document level.
- The `$type` precedence is our reading of section 5.2.2. If the spec's two sections are reconciled differently, alias tokens inside typed groups may need to change.
- `ALIAS_TARGET_INVALID` depends on callers passing `rejected` from `flatten()`; without it, an alias to a dropped token still reports `ALIAS_NOT_FOUND`.
- Large cycles produce one issue per member, with an abbreviated path in the message for cycles longer than ten tokens; the full member list is in `related`.
- Allowing literals in semantic and component tiers weakens the "change a brand in one place" story: a literal there will not follow a primitive change. A future lint-like warning or a stricter rule may be worth adding.
- The 8-bit tolerance means a `hex` that is off by one step is never reported, which is intentional but means `hex` is only a loose fallback check.
- Property tests use bounded run counts and simple generators to keep CI fast; they will not find every edge case.
