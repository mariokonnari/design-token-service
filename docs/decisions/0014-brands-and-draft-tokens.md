# 0014. Brands and draft tokens

- Status: Accepted
- Date: 2026-10-12
- Builds on: [0006](0006-token-subset-and-tier-rules.md), [0012](0012-data-model-and-tenancy.md), [0013](0013-auth-sessions-and-http-layer.md)
- Amended in Phase 4a: organization and brand **slugs are at most 63 characters** (`src/slug.ts`, the DNS label limit), enforced by the repositories, by the database (hand-written CHECKs `Organization_slug_length` and `Brand_slug_length`, migration `20261012150000_slug_length`; `db:drift` cannot see them, `test/db/constraints.test.ts` guards them) and by the public routes. The 400 for a bad slug or name on create now carries `details.field` (`slug` or `name`) so a client can mark the field. A duplicate brand slug is still the generic 409 `CONFLICT` (an organization duplicate is `SLUG_TAKEN`).
- Amended in Phase 3d ([0015](0015-releases-and-public-api.md)): the token-version ABA hole is fixed (a create gets the new `draftRevision` as its version), the `flatten` quadratic-depth finding is fixed in tokens-core, and `validateDraft` gained two release rules.

## Context

Phase 3a/3b gave the API tenancy and sessions but no tenant data. Phase 3c adds the first: **brands** and each brand's **draft tokens** (one row per token, ADR 0012), with draft validation and a bulk import. Two risks drive the design: a cross-tenant leak through a parent/child id mismatch (a brand id from organization A used through organization B's URL), and lost updates when several editors change one brand at once. The draft **may be invalid** while it is edited (ADR 0012); validation is a separate, on-demand step.

## Decision

### Brands

`POST/GET /api/orgs/:orgId/brands`, `GET/PATCH /api/orgs/:orgId/brands/:brandId`, all in the route table (ADR 0013). Create and rename need EDITOR; reads need VIEWER; **changing `visibility` is OWNER-only**. PATCH is open to editors and narrowed by `canChangeVisibility` in `tenancy/policy.ts` (`refinedBy`), and a request that mixes a rename with a visibility change from an editor is refused whole (403, nothing applied). The **slug is immutable** (it is part of future public URLs; renaming it later needs redirects). The brand view never includes `organizationId`.

**There is no brand delete in v1.** `Release -> Brand` is RESTRICT (ADR 0012) and `Token -> Brand` is CASCADE, so a delete would either be blocked by the first release or silently destroy the whole draft. It needs its own design (soft delete or an explicit purge), not a default.

**404 for the wrong parent.** Every brand query filters by the `organizationId` of the scope. A brand of another organization, a random uuid and a malformed id give the **same 404 and body**, including when the caller is OWNER of both organizations and the only wrong thing is the parent. The leak matrix has a dedicated wrong-parent case for **every route that contains `:brandId`** (and fails if one has no case), and a **foreign token path** case: a token path that exists only in organization A's brand, asked through organization B's own brand, answers exactly like an invented path and touches nothing.

### The brand-row lock, and `draftRevision`

**Every draft mutation (PUT, DELETE, import) runs in one transaction:** lock the brand row (`SELECT ... FOR UPDATE`, filtered by organization), apply the change, increment `Brand.draftRevision` by exactly 1, return it. The three steps live in one private `mutate()` helper in `repositories/tokens.ts`, so no mutation can forget the lock or the bump. A rejected change (400/404/409) rolls back before the bump, so **a failed mutation never moves `draftRevision`** (tested). Reads take no lock: they run in one REPEATABLE READ snapshot, so `{draftRevision, tokens}` always agree (tested with 12 concurrent reads against 8 concurrent writes, 15 rounds: `tokens.length === draftRevision` every time).

`draftRevision` semantics: it is the number of successful draft mutations, starting at 0 for a new brand. It is what a release records as `sourceRevision` (ADR 0012) and what an import must quote (`expectedRevision`). An import counts as one mutation.

**Inside the lock only the transaction client is used** (never the outer client), so a transaction never needs a second connection. Tested: the first race scenario passes with the API's pool limited to **3** connections.

### Optimistic concurrency per token

`PUT /tokens/:path` with strict body `{type?, value, description?, expectedVersion?}`:

| State of the path | `expectedVersion` | Result |
|---|---|---|
| exists | absent | 409 `VERSION_REQUIRED` (body carries `currentVersion`) |
| exists | wrong | 409 `VERSION_CONFLICT` (carries `currentVersion`) |
| exists | right | 200, `version + 1` |
| missing | present | 409 `VERSION_CONFLICT` (`currentVersion: null`): there is nothing to match |
| missing | absent | 201, `version` = the new `draftRevision` (ABA, below; on a brand's first token that is 1) |

**The version invariant (Phase 3d, fixes the ABA hole).** A token's `version` never exceeds the brand's `draftRevision` at its last write. Under the brand lock, with `r` the locked revision and `r + 1` the revision the mutation writes: a **create** gets `version = r + 1`; an **update** gets `version + 1` (safe: the old version was at most `r`, so the new one is at most `r + 1`); an **import** gives a surviving path `old + 1` and a new path `r + 1`. A path deleted and re-created therefore always gets a version larger than any it ever had (every earlier version was written at a revision at most `r`), so an editor holding the old version can never match the new token, with no tombstones. Existing rows already satisfy the invariant (created at 1 with a revision of at least 1, +1 per bump), so there was no data migration. Tested: create, delete, re-create, then a PUT or DELETE with the OLD version is 409; a seeded random sequence of create/update/delete/import checks `version <= draftRevision` after every step and that no path ever reuses a version.

**No no-op detection**: sending identical data still bumps `version` and `draftRevision` (comparing JSON values would add a code path that could disagree with the database, for no safety gain). The editor must **refetch on any 409**; in particular a retried create after a lost response gets `VERSION_REQUIRED`.

`DELETE /tokens/:path?expectedVersion=N` requires the version **in the query string**: a DELETE body has no defined semantics (RFC 9110) and the Vercel to Render proxy chain (ADR 0013) may drop it. (An `If-Match` header was the alternative; the query string keeps PUT and DELETE close and is visible in tests and logs. The log keeps the path without the query, ADR 0013.) A missing token is 404, a stale version 409. **Aliases pointing at a deleted token are not blocked**; `/validate` reports them.

**Path conflict.** A path cannot be both a token and a group (`a` and `a.b`). On create, inside the lock, the repository refuses a path that has an existing token as a proper prefix or that is itself the prefix of an existing token: 409 `PATH_CONFLICT` with `conflictsWith`. The prefix test uses whole segments (`a` vs `ab` is not a conflict).

### Write validation reuses tokens-core

A token is validated by building a **one-token tree from the path segments** and calling tokens-core's `flatten`, so the type, literal and alias rules live in exactly one place (`tokens/validateWrite.ts`). Every segment is checked with `isValidName` first. A failure is `400 INVALID_TOKEN` with `details.issues` (`code`, `severity`, `path`, `field`, `message`; at most 50, with the total in `issueCount`). Warnings (`HEX_MISMATCH`) are returned in `warnings`. `1e999` (which `JSON.parse` turns into `Infinity`) is rejected for `number`, `dimension`, `color` and `fontWeight` and **can never be stored as `null`** (tested on PUT and import, including a query for `null` JSON values).

**Reserved names:** `__proto__`, `constructor` and `prototype` are refused as a token or group name anywhere (PUT and import). `__proto__` already fails the name pattern; the other two are valid names that attack plain-object code (`tree[segment]`), so they are refused on purpose. This is a policy tokens-core does not have.

### Limits

| Limit | Value | Response |
|---|---|---|
| path length | 200 characters | 400 on PUT; 404 on DELETE (it cannot exist) |
| value | 8192 bytes of JSON | 400 (`field: value`) |
| description | 500 characters | 400 (`field: description`) |
| tokens per brand | 2000 | 409 `TOKEN_LIMIT` on create (a valid request that conflicts with current state); **400** on import (a property of the document) |
| `expectedVersion`, `expectedRevision` | integers 1..2147483647 (revision 0..) | 400, never 500 (the columns are int4) |
| import body | 512 KB (route) vs 16 KB (global) | 413 |
| import tree | depth 32, 10,000 objects | 400 |

The **same per-token limits apply to import**: every imported token goes back through `validateSingleToken`.

### Draft validation is separate

`GET /brands/:brandId/validate` returns `{draftRevision, publishable, issues}`. `tokens/validateDraft.ts` is **pure** (rows in, issues out) so the future publish step reuses it: rows -> mapper (corrupt rows become `UNMAPPABLE_ROW` and are passed to `resolve` as `rejected`) -> `resolve` -> **rules** (`checkTiers`, CSS-name collisions). `publishable` means at least one token and no error-severity issue. **An empty draft is not publishable** and says so (`EMPTY_DRAFT`). **Adding a rule** (the Phase 5 contrast gate): write a `Rule = (context) => issues` and call `validateDraft(rows, [...DEFAULT_RULES, contrastRule])`; callers and the result shape do not change. A rule that throws becomes one `RULE_FAILED` error (fail closed).

`src/tokens/mapper.ts` converts a stored row to a tokens-core `Token` and back. It is **defensive**: a corrupt stored row (a raw SQL edit, an old bug) is an `UNMAPPABLE_ROW` issue and never an exception. `GET /tokens` returns such rows raw (so they can be deleted), `GET /tokens/tree` leaves them out and reports them, `/validate` makes the draft unpublishable. `UNMAPPABLE_ROW`, `EMPTY_DRAFT` and `RULE_FAILED` are codes of this API, not of tokens-core.

### Import: replace only

`POST /tokens/import` with strict `{tree, expectedRevision}` (any other key, such as `mode`, is a 400). The tree is validated first, outside the lock (`tokens/validateImport.ts`): structure guard, `flatten`, at least 1 and at most 2000 tokens, the per-token limits. **Any error-severity issue refuses the whole import** (400 `INVALID_IMPORT`, issues listed, nothing changes). An **empty import is refused** too (a replace with nothing would wipe the draft by accident). Under the lock: a revision mismatch is 409 `REVISION_CONFLICT` (with `currentRevision`); otherwise delete all draft tokens and insert the new ones in one statement, then bump.

**An import keeps versions counting up:** a path that survives gets `old version + 1`, and a new path gets the revision the import writes (it started at 1 before Phase 3d, which left a delete-then-import ABA hole). Resetting to 1 would let an editor holding version 1 of the old token match the replaced one.

**Hostile trees.** `tokens/treeGuard.ts` walks the tree **iteratively** before `flatten`: depth over 32, more than 10,000 objects or a reserved key is a 400. The reason is measured, not theoretical: `flatten` does not overflow the stack (it is iterative) but it **copies the path array at every level, so it is quadratic in depth**. One-token tree nested n levels, on the development machine: 5,000 levels 0.5 s, 10,000 levels 2.2 s, 20,000 levels 10.7 s, **50,000 levels 68 s of synchronous CPU** (the event loop is blocked for everyone), from a 300 KB body well under the cap. `JSON.parse` of that body takes 12 ms, and on Node 24 it never threw a `RangeError`, even at 1,000,000 levels (6 MB); the 400 `INVALID_JSON` mapping for a `RangeError` is pinned anyway by making `JSON.parse` throw for one marked body. **Fixed in Phase 3d:** `flatten` no longer copies the path per level. Its group frames form a parent chain (O(1) per level) and path strings are built lazily, only when an issue needs one, and once per token. Measured with the same scratch script on the same machine, before and after: 5,000 levels 547 ms to 14 ms, 10,000 levels 2,156 ms to 14 ms, 20,000 levels 10,378 ms to 35 ms, 50,000 levels 68,251 ms to 49 ms, 200,000 levels 156 ms. What remains is O(depth) per token, which is the size of the token's own path. A regression test (20,000 levels, bound 3 s; it measured 10.5 s before the fix) and a test of lazily built issue paths were added to tokens-core; all 552 existing tests, property tests included, stayed green. **The API-side depth guard stays** as defense in depth.

**Body limit and rate limit.** The global parser is 16 KB. A route can declare `bodyLimit` in the route table; `createApp` replaces the global parser with a wrapper (still named `jsonParser`, so the route guard's expected middleware list is unchanged) that **skips exactly the routes that declare one**, and `mountRoutes` adds `express.json({limit})` to that route's chain **after** authentication, the role check and the rate limiter. So a body of 512 KB is never read for an unauthenticated caller (401), a non-member (404), a viewer (403) or a rate-limited user (429): tested with ~400 KB of syntactically **invalid** JSON, which gets 401/404/403 rather than 400/413. The matcher is exact and case-sensitive, so any disagreement with Express (a trailing slash, other letter case) lands on the **small** limit, the safe direction (tested). The import route has a per-user limiter (`tokenImport`, default 10 per 10 minutes, injectable, built on the same `createRateLimiters` code; refused callers do not use up the allowance because it runs after the access checks).

### Waiting policy: bounded, never a hang

Prisma 7's interactive-transaction defaults are `maxWait` 2000 ms and `timeout` 5000 ms. They are set explicitly with the lock timeout (`db/txTiming.ts`):

| Limit | Value | Meaning | Failure |
|---|---|---|---|
| `lockTimeoutMs` | 3000 | `SET LOCAL lock_timeout` (via `set_config(..., true)`, which also works behind a transaction pooler) | Postgres 55P03 -> **503 `SERVICE_BUSY` + `Retry-After: 1`** |
| `txTimeoutMs` | 8000 | the whole transaction | Prisma P2028 -> 503 |
| `maxWaitMs` | 3000 | waiting for a pooled connection to start the transaction | Prisma P2028 -> 503 |

**`lockTimeoutMs` must be strictly less than `txTimeoutMs`** (otherwise Prisma may abort first and the cause is lost): the repository refuses a configuration that violates it at construction, and a unit test asserts it for the defaults. Tested against real Postgres: a raw connection holds the brand lock; a PUT with a 300 ms lock timeout answers 503 within the timeout (>= 250 ms, < 2 s), and the holder's own update then commits untouched; a DELETE behaves the same; a repository with a pool of one connection answers 503 for the second request (maxWait 200 ms), and the first request succeeds once the lock is released. **Not tested:** a transaction-timeout expiry (there is no way to inject a slow statement without test-only code in the repository); the P2028 mapping is unit-tested with a synthesized error, and it is the same code path as the `maxWait` case that is tested end to end.

## Alternatives considered

- **Per-token optimistic concurrency only (no brand lock).** Cannot protect the cross-token invariants: the path-conflict rule (`a` vs `a.b`), the 2000-token cap and `draftRevision` itself are properties of the brand, not of one token. Two concurrent creates of `a` and `a.b` both pass a check-then-insert. (Measured: with the lock removed, the `a`/`a.b` race and the same-version race fail; the distinct-path and same-path races still pass, masked by the atomic revision `UPDATE` and the unique constraint. Those two scenarios are therefore not proofs of the lock on their own.)
- **Postgres advisory locks** (`pg_advisory_xact_lock(hash(brandId))`). Same serialization without touching the row, but the key is a 64-bit hash (collisions between brands), the lock is invisible in `pg_locks` joins to the row, and it adds a second concept. The brand row already exists, is already the thing being versioned, and its lock composes with the foreign keys.
- **Serializable isolation with retries.** Correct, but turns every conflict into a retry loop in the application and a 40001 the client has to understand.
- **`expectedRevision` on every PUT** (one revision for the whole draft, no per-token version). Every unrelated edit by another editor would conflict. Per-token versions conflict only on the same token.
- **Rejecting an invalid draft at write time.** Editing passes through invalid states (a half-typed alias, a cycle while rewiring); ADR 0012 already decided drafts may be invalid.
- **Merge import.** More useful, much harder to specify (what is a conflict? what about deletions?). Replace is atomic and exactly specifiable; merge can be added as a new mode later because the body is strict.
- **Streaming/NDJSON import.** Would lift the 512 KB cap; not needed at 2000 tokens.

## Consequences and honest gaps

- **Per-brand write serialization.** All writers to one brand queue on one row. At 8 concurrent writers the throughput is fine (the race suite does it hundreds of times); a brand with many simultaneous editors would feel it. Different brands never block each other.
- **ABA on delete and re-create: fixed in Phase 3d** (see the version invariant above). The "create gives version 1" contract changed to "create gives the new `draftRevision`"; for a brand's first token the two are the same.
- **No pagination** on `GET /tokens`, `/tokens/tree` or `/validate`: bounded by the 2000-token cap, not by paging. `/validate` is O(n) per call and not cached; latency at 2000 tokens is **unmeasured**.
- **No audit log** of who changed what (the brand revision counts changes but does not record them).
- **No quotas** on brands per organization or on write routes. `SIGNUP_ENABLED` is the only abuse control; only the import route has a rate limit (in memory and per instance, ADR 0013).
- **Cross-tenant 404 is only as good as the filters.** There is still no database-level backstop (ADR 0012). The convention test sees `tx.<model>` calls and raw queries in exported functions and public methods, and **ignores private methods**; the lock and the bump therefore live in exported functions (`lockBrand`, `bumpRevision`) that take a `TenantScope` first, so they are checked. The convention test is a text heuristic; the wrong-parent matrix and the mutation proofs below are the real guards. The first statement of `lockBrand` (existence + `lock_timeout`) and the lock statement both filter by organization, so **either one alone masks the removal of the other**; the proof removes both.
- **The locking behavior is verified only against a direct Postgres connection.** Row locks and `set_config(..., true)` inside a transaction should work behind Supabase's transaction pooler, but that is an untested Phase 6 assumption (ADR 0012, 0013).
- **Race tests run through one Node process.** They exercise real database locking, not several API instances.
- **jsonb normalizes numbers and key order.** A stored value reads back equal in value, not byte for byte.
- **Reserved names** (`constructor`, `prototype`) mean a legitimate token cannot use them. Existing rows with those names (none can exist yet) would map fine but could not be re-created.
- **The 512 KB cap and the 16 KB cap come from different code** (the route table and `createApp`); a route that declares `bodyLimit` is the only way to get the larger one, and a test pins the exact list.
- **Tokens-core finding: fixed in Phase 3d** (above). The guard stays.

## Verification summary

**Race tests** (real concurrent HTTP requests against real Postgres, `test/tokens/race.test.ts` and `import.test.ts`). Iteration counts: **8 concurrent creates of distinct paths, 50 iterations** (each iteration is 8 requests; lower than 100 because each also reads the table back and checks that every response reported a distinct revision 1..8); **two updates with the same `expectedVersion`, 100**; **`a.x` against `a.x.y`, 100**; **the same path from 4 requests, 100**; update against delete, 30; import against PUT, 50 (both legal orders are asserted, never a torn state); two imports with the same revision, 20; the consistent-snapshot read test, 15 rounds of 8 writes and 12 reads; the pool-of-3 run, 10 iterations of scenario 1. The suite takes about 60 s for these files.

**Mutation proofs.** Each mutation was applied to the real source, the token/brand/matrix/convention tests were run (16 files, 403 tests, all green before each), and the file was restored with its sha256 verified.

| Mutation | Failing tests |
|---|---|
| (a) remove the brand-row lock (`FOR UPDATE`) | 4 (same-version race, `a.x`/`a.x.y` race, update-vs-delete race, two concurrent imports) |
| (b1) skip the `expectedVersion` check on PUT | 5 |
| (b2) skip the `expectedVersion` check on DELETE | 3 |
| (c) drop `organizationId` from `BrandRepository.get` | 3 (cross-tenant repository test, **wrong-parent matrix**, convention test) |
| (d) skip the path-conflict check | 5 |
| (e) do not bump `draftRevision` for delete and import | 8 |
| (f) a brand route answers 403 for wrong-parent access | 2 (wrong-parent matrix, brand 404 test) |
| (g1) drop `organizationId` from **both** statements of `lockBrand` | 2 (**wrong-parent matrix**, convention test) |
| (g2) drop it from the `FOR UPDATE` statement only | 1 (convention test only) |
| (g3) drop it from the existence/`lock_timeout` statement only | 1 (convention test only) |

Reading the table honestly: (g2) and (g3) are **masked in behavior** (the other statement still filters by organization, so no request can tell), and are caught only by the text-heuristic convention test. That is the intended defense in depth, and it is also the limit of what the behavioral tests can prove about the lock statement on its own.

**Final run of the whole definition of done** (local, then again from a clean copy of the tree with a fresh `postgres:17` container, mirroring `.github/workflows/ci.yml`): fresh-database migration and `db:drift` clean (no schema change was needed), `generate:theme` twice with no diff, typecheck, lint and format clean, tests **tokens-core 552, ui 496, api 1045** (35 files; the API suite takes about 2.5 minutes because of the real-concurrency tests), build, `smoke:api` with no `.env` and no database (`/ready` is 503), Storybook build, and **434 e2e tests**.

Also note the scenario masking measured with the lock removed (see Alternatives): the distinct-paths and same-path races pass without the lock because of the atomic revision `UPDATE` and the unique constraint.
