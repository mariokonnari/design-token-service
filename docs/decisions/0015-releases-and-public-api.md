# 0015. Releases and the public API

- Status: Accepted
- Date: 2026-10-12
- Amended in Phase 4a: the public slug cap is **63** characters, the same rule as creating a slug (`src/slug.ts`, [0014](0014-brands-and-draft-tokens.md)); it was 200 and the API had no cap on creation. Anything longer is the same uniform 404 before any database access.
- Builds on: [0002](0002-token-model-and-theming.md), [0007](0007-css-export-and-contrast.md), [0012](0012-data-model-and-tenancy.md), [0013](0013-auth-sessions-and-http-layer.md), [0014](0014-brands-and-draft-tokens.md)

## Context

Phase 3c ended with a draft: mutable token rows under a per-brand lock and a `draftRevision`. Phase 3d turns a valid draft into a **release**: an immutable, numbered artifact (source-tree snapshot, generated CSS, sha256 of the CSS) that members can read and that anyone can fetch from a stable URL **if the owner made the brand public**. Three risks drive the design: a publish racing a draft change must never store a half-state; a private brand must never leak through the unauthenticated routes (not even by the shape of a 404); and a published release must stay what it was.

Two defects of Phase 3c were fixed first: the token-version ABA hole and the quadratic `flatten` (both described in [0014](0014-brands-and-draft-tokens.md), now amended).

## Decision

### Publish runs under the brand lock

`POST /api/orgs/:orgId/brands/:brandId/releases` (EDITOR or OWNER), strict body `{ expectedRevision: int 0..2147483647, note?: string <= 500 }`. One transaction (READ COMMITTED, the lock/transaction timeouts of [0014](0014-brands-and-draft-tokens.md), busy mapped to 503 `SERVICE_BUSY` + `Retry-After`):

1. **lock the brand row** (`lockBrand`, the same `FOR UPDATE` every draft mutation takes);
2. compare `expectedRevision` with the **locked** `draftRevision` (409 `REVISION_CONFLICT` with `currentRevision`);
3. **only now** read the draft rows (and the immutable brand slug). Under READ COMMITTED each statement sees everything committed by the writers that held the lock before us, so the rows and the revision always describe the same draft; reading earlier would not;
4. `buildRelease` (pure): `validateDraft` with the default rules, then the snapshot (`nest`), the CSS (`resolve` + `toCssVariables`, scope `[data-theme="<brand slug>"]`, **semantic and component tiers only**) and `cssSha256`. It fails closed: any disagreement between the validation and the build (an issue from `nest` or the exporter, an empty stylesheet) refuses the publish. 409 `DRAFT_NOT_PUBLISHABLE`, `details.issues` (at most 50) and `issueCount`;
5. **NO_CHANGES**: if the latest release has the same `sourceRevision`, 409 `NO_CHANGES` with `latestReleaseNumber`; then **RELEASE_LIMIT** (below);
6. `number` = the latest number + 1, taken **under the lock**; a unique violation on `(brandId, number)` is a backstop mapped to 409 `RELEASE_CONFLICT`, never a 500.

**Publishing does not change `draftRevision`.** Response 201: release metadata only (`number, sourceRevision, note, createdAt, createdById, cssSha256`; no snapshot, no CSS). A per-user rate limit (`publish`, default 10 per 10 minutes, injectable, same code as the import limiter) runs after the access checks and before any database work, so a refused caller (a viewer) does not use up the allowance.

### What a release needs is part of `validateDraft`

So `GET /validate` and publish **always agree**, two rules are in `DEFAULT_RULES`:

- **`NOTHING_TO_EXPORT`**: every token resolved but no semantic or component token exports (a primitives-only draft would publish an empty stylesheet). It is not added to drafts that already have a more specific problem (empty, unresolved, only unmappable rows).
- **`RELEASE_TOO_LARGE`**: snapshot bytes + CSS bytes above `MAX_RELEASE_BYTES`. The size is defined as `byteLength(JSON.stringify(snapshot)) + byteLength(CSS generated with the root scope)`, because `validateDraft` has no brand slug; the stored CSS is longer only by the `[data-theme="<slug>"]` selector.

The existing tests whose drafts were primitives-only changed: in `validateDraft.test.ts` "warnings alone do not block publishing" (a semantic alias was added), "DEFAULT_RULES" (2 rules became 4), "two paths that map to the same CSS variable" and "a rule that throws" (a semantic token / alias was added so the draft stays exportable); in `validateRoute.test.ts` "a CSS name collision" (a semantic token was added). Nothing was weakened: each still asserts what it asserted.

### Storage caps and the CPU cost, measured

Releases are immutable and there is no delete or purge, so storage is bounded up front. Measured on the development machine (scratch scripts, 2000 tokens, node 24):

| Draft | Snapshot + CSS | Notes |
|---|---|---|
| realistic large brand (400 primitives, 800 semantic and 800 component aliases, short descriptions) | **191,045 B** (136,040 + 55,005) | |
| the largest draft the cap accepts (2000 semantic font tokens, ~200 characters each) | 943,827 B | |
| worst case the per-token limits allow (2000 exported tokens, ~8 KB values, 500-character descriptions) | **36.2 MB** | rejected by the cap |

Chosen: **`MAX_RELEASE_BYTES` = 1,048,576 (1 MiB)**, about 5.5x the realistic release and 35x under the worst case, and **`MAX_RELEASES_PER_BRAND` = 200** (checked under the lock after `NO_CHANGES`: 409 `RELEASE_LIMIT` with `details.limit`). Worst-case storage per brand is therefore 200 MiB (a realistic brand: about 38 MB). Both boundaries are tested (exactly at the cap passes, one over fails: the size at the real cap is padded to the exact byte; the 200th release is accepted, the 201st is 409).

**A brand at `RELEASE_LIMIT` cannot publish again until an archive/purge design exists** (releases are immutable on purpose). 200 is deliberately generous for that reason. There are still no per-organization quotas (a determined editor can create many brands).

**The cap needed a CPU guard.** The exact size needs `resolve` plus the CSS, and the worst-case draft costs about **0.7 s of event-loop time in today's `GET /validate`** (a Phase 3c exposure that any EDITOR could trigger) and 1.4 s in a naive publish. `validateDraft` therefore first sums the **raw stored bytes** (values, descriptions, paths; O(n)) and returns `RELEASE_TOO_LARGE` at once when they already exceed the cap. For rows written through the API this is a lower bound of the snapshot (stored values are the validated, normalized ones), so it never rejects a draft the exact rule would accept; for a hand-edited row it is a conservative reading of "too large". The exact rule still catches **CSS amplification** (a tiny stored draft whose aliases multiply one big value; tested). The pre-check is covered by a test that proves no mapping, resolve or rule runs for an oversized draft.

**Measured CPU of `buildRelease`** (validate + nest + resolve + CSS + sha256), synchronous, median (min to max):

| Draft | `buildRelease` | `validateDraft` alone |
|---|---|---|
| realistic, 2000 tokens | **55 ms** (46 to 110) | 30 ms |
| largest accepted (944 KB) | **59 ms** (51 to 85) | |
| worst case (refused by the cap) | 43 ms | **36 ms** (was 679 ms before the pre-check) |

All are well under the ~250 ms bar, so no further change was made. **It blocks the event loop for ALL requests while it runs, not only the brand's writers**, and it holds the brand lock (other writers to that brand get 503 after 3 s). p99 under real load is unmeasured.

### NO_CHANGES: idempotency by revision

Republishing an unchanged draft is 409 `NO_CHANGES` carrying the **existing** release number, so a retried publish after a lost response is harmless and N concurrent publishes at one revision give exactly one 201. The comparison is on `sourceRevision`, **not on content**: a change followed by its exact inverse bumps the revision and can be published as an identical release (this is also what makes a rollback publishable, below).

### Stored CSS and hash versus regeneration

A release stores the snapshot, the generated CSS and `cssSha256`. The CSS is **not** regenerated on read: a later exporter change must not alter a published release, and the hash is the strong ETag of the authenticated CSS route. Regeneration from the snapshot is still **deterministic** (everything is sorted by path) and a test proves that `flatten` + `resolve` + `toCssVariables` over a stored snapshot reproduces the stored CSS byte for byte, which is the check to run after an exporter change. Exporter output for a release is also tested for safety (one selector line, one declaration per line, no `var()`, no `<`, with a hostile font name whose quotes, braces and `</style>` all stay inside one escaped string).

### Immutability: a trigger, and what it does not do

A hand-written migration (`20261012140000_release_immutable`) adds a **`BEFORE UPDATE OR DELETE` row trigger** on `"Release"` that raises `Release rows are immutable`. Tests (raw SQL): every kind of UPDATE (css, snapshot, note, number, hash, a no-op update) and DELETE fails with that message, INSERT works, `TRUNCATE ... CASCADE` still works (the harness truncates every table), and the trigger exists in `pg_trigger`.

Limits, stated plainly: it guards **application bugs, not a superuser or the table owner** (`ALTER TABLE ... DISABLE TRIGGER`, `session_replication_role = replica`); it does **not** fire on TRUNCATE; **`db:drift` cannot see triggers**, so `releaseImmutable.test.ts` is the only guard against removing it (proven by mutation (e) below); the foreign keys from `Release` to `Brand` and `User` are RESTRICT, so those deletes are refused earlier (23503). The real next step is a least-privilege application role without UPDATE, DELETE and TRUNCATE on `"Release"`.

In the application, `ReleaseRepository` exposes **no update and no delete**: a test pins its public methods to exactly `get, getCss, list, publish`, and a source scan (TypeScript AST) over `src/**` fails on `release.update/upsert/delete*`, a nested `releases: { update ... }` write and any SQL that updates, deletes or truncates `"Release"` (with self-tests that flag bad samples). The scan is a text heuristic; the trigger is the real guard.

### Reads

`GET .../releases` (VIEWER+): metadata only, **newest first, cursor pagination**: `?before=<number>&limit=` (strict query: digits only, `limit` 1..100 default 20, `before` 1..2147483647; an unknown, repeated or empty parameter is a 400). The response is `{ releases, nextBefore }`; `nextBefore` is null on the last page, **also when that page is exactly full** (the repository fetches `limit + 1`). A cursor on the number is stable under concurrent publishes (new releases only appear at the top) and needs no offset scan. `GET .../releases/:number`: metadata plus the snapshot. `GET .../releases/:number/css`: `text/css; charset=utf-8`, **strong `ETag: "<cssSha256>"`**, `Cache-Control: private, no-cache`, `If-None-Match` (exact, weak form, list, `*`) gives 304. `:number` must be a positive int32 written as digits, otherwise it is the same 404 as a number that does not exist. A number of another brand or organization is that same 404 (the leak matrix gained the four release routes, a rule that every route containing `:number` must declare the foreign-release cases, and a dedicated test with two brands that both have release 1).

### Rollback is an import of a release snapshot

`GET /releases/:n` returns the snapshot, which is a valid import tree: `POST /tokens/import { tree: snapshot, expectedRevision: <current> }` makes the draft that release's source tree again, and publishing it yields a new release identical to the old one (a test proves the CSS, hash and snapshot are byte-equal). There is no "restore" endpoint on purpose.

### Public routes

`GET /api/public/orgs/:orgSlug/brands/:brandSlug/css` and `/json` (access `'public'` in the route table): no session, **the latest release only, and only if the brand is PUBLIC**.

- **One query** walks organization slug, brand slug and `visibility: 'PUBLIC'` to the newest release, so there is no check-then-read gap and **a flip to PRIVATE is effective on the very next request** (nothing is cached on the server). The slugs are validated (`isValidSlug`: the name rule and at most 63 characters, the same cap as creating a slug since Phase 4a; before that the public cap was 200 and creation had none) **before any database access** (tested with a database double that fails on use).
- **404 uniformity**: a private brand, a missing brand, a missing organization, a brand in another organization, a brand with no release and a malformed slug give **the same status, the same body bytes and the same headers** (compared apart from the request id, the date and the rate-limit counter, which depends on how many requests came before and never on why one was refused). A session cookie changes nothing: the routes do not authenticate. The public repository lives in `src/repositories/public/` under a **third convention class** (no `TenantScope`, only read operations on Release, Brand and Organization, no raw SQL, and every query must name `visibility: 'PUBLIC'`, with self-tests), because it is the one place where tenant-owned rows are read without an `organizationId`.
- **Headers, on these two routes only** (a first middleware, so the 404 and 429 carry them too): `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin: *` (never reflected, never `Allow-Credentials`), `Cache-Control: public, max-age=60`, a strong ETag with 304, correct content types, helmet's `nosniff` untouched. **What helmet sets** (helmet 8.3.0, read in `helmet/index.cjs`): `Cross-Origin-Resource-Policy: same-origin` by default, which would make a browser refuse `<link rel="stylesheet">` from another site; the route-level header overrides it. A test asserts that **every other route** (`/health`, an authenticated route, an unknown path) keeps `same-origin` and sends no `access-control-*` header, so the Phase 3b "no CORS" tests stay true. 404, 429 and 500 answers send `Cache-Control: no-store`.
- **Only "simple" cross-origin requests are supported** (a plain GET with no custom headers). A cross-origin fetch with custom headers triggers a preflight, which gets **no CORS headers by design** (tested; the existing no-CORS tests stay).
- **HEAD** is served through the GET route: same status and headers, no body, 304 when conditional, and the identical uniform 404 (tested).
- **Rate limit**: per IP (IPv6 masked to a /56), default 120 per minute, injectable, running before any database work (a blocked request is proven to cost zero queries). It is in memory and per instance ([0013](0013-auth-sessions-and-http-layer.md)), and only as good as `TRUST_PROXY`.
- **`/json` is the SOURCE tree** (aliases such as `{primitive.color.blue}`, not resolved values) and **includes token descriptions: making a brand PUBLIC publishes them**, so do not put anything private in a description of a public brand. The JSON ETag is the sha256 of the response body (no extra column).
- **Caching trade-off**: `max-age=60` bounds how stale a browser or CDN can be after a new release or after a flip to PRIVATE (up to 60 s downstream; there is no purge). **No `immutable`**: the URL always means "the latest release", so its content changes. A versioned immutable URL (`/releases/:n/css` for the public) would allow it, and is future work.
- **Who controls public content**: an **EDITOR can publish to an already PUBLIC brand**, so editors control what the world sees; only changing `visibility` is OWNER-only ([0014](0014-brands-and-draft-tokens.md)). Making publish OWNER-only for public brands would be a one-line policy change.
- **Browser behavior is verified only at the header level until Phase 6.** The CORP/CORS headers are asserted, but a real cross-origin `<link rel="stylesheet">` load has not been run (the Playwright suite covers Storybook only, [0010](0010-real-browser-testing.md)). Phase 6 must check it on the deployed URL.

## Alternatives considered

- **Publish without the brand lock** (unique constraint plus a revision check). Measured: the lock-less version failed 5 of the 7 race tests (below), and the unique constraint turns would-be duplicates into 409s with the wrong code. The stress tests alone cannot prove the lock ([0014](0014-brands-and-draft-tokens.md) precedent), which is why the deterministic lock-hold tests exist.
- **`SERIALIZABLE` or `REPEATABLE READ` for publish.** Correct, but a conflict becomes a 40001 the client must understand; the row lock the draft already uses gives the same result with one concept.
- **Regenerating the CSS on read.** Smaller storage, but an exporter change would silently alter published releases.
- **Content-based `NO_CHANGES`** (compare snapshots). Catches a change and its inverse, but needs a canonical comparison that could disagree with the database; revisions are exact and cheap.
- **Offset pagination.** Skips and repeats rows when releases are published during paging, and scans.
- **A row-level `CHECK` instead of (or besides) the application cap on size.** Not added; the rule lives in `validateDraft`, where the user can see it.
- **Public routes under `authenticated` with a share token.** More control (revocation, per-consumer limits) but a much bigger feature; PUBLIC visibility is the existing, owner-controlled switch.
- **`Access-Control-Allow-Origin` from an allowlist.** Public by definition means any origin; `*` without credentials is the honest setting.

## Consequences and honest gaps

- **No unpublish, no webhooks, no CDN purge, no release diff** (a diff belongs with the Phase 5 contrast gate, which is one more `validateDraft` rule). A release cannot be removed, so a brand at the cap is stuck.
- **A flip to PRIVATE or a new release can be served stale for up to 60 s** by browsers and shared caches.
- **The trigger is bypassable by the owner** and `db:drift` cannot see it; there is no least-privilege database role yet.
- **Publish is synchronous CPU** (55 ms realistic, 59 ms at the cap): it blocks the event loop and holds the brand lock. Unmeasured under load.
- **The raw-bytes pre-check is conservative** for hand-edited rows, and `RELEASE_TOO_LARGE` may be reported without the other issues of that draft.
- **In-memory limiters** (publish and public) are per instance and reset on restart.
- **Slugs have no length limit at creation**, but the public URL accepts at most 200 characters.
- **Concurrency is verified through one Node process and a direct Postgres connection.** Several API instances and the Supabase transaction pooler are Phase 6 checks ([0012](0012-data-model-and-tenancy.md), [0013](0013-auth-sessions-and-http-layer.md)).
- **`createdById` is exposed to members** (a user id, no email) in the release metadata; the public routes expose nothing about who published.

## Verification summary

**Race tests** (real HTTP, real Postgres, `test/releases/publishRace.test.ts`): six concurrent publishes at one revision, **100 iterations** (exactly one 201, five 409 `NO_CHANGES`, numbers contiguous 1..100); a publish racing a token PUT, **100 iterations per variant** (A: publish at `r` against a PUT, B: publish at `r+1`; a random 0 to 39 ms head start makes both orders happen: with the lock, variant A published 41 times and lost 59, variant B published 53 and lost 47 in the recorded run, and the test fails if either outcome never happens); the six-at-once scenario with the pool limited to **3** connections, 15 iterations; and two **deterministic** lock-hold tests (a raw connection holds the brand lock, the publish waits, the holder commits): the release **number** must be taken after the holder's release (3, not 2) and the **rows** after the holder's change.

**The lock-less version, run first and shown red as planned** (publish implemented without `lockBrand`, every other line identical): **5 of the 7 race tests failed**: six-at-once (the five losers got `RELEASE_CONFLICT` from the unique constraint instead of `NO_CHANGES`), variant A (in the recorded run a publish returned 201 whose snapshot was not the draft at its `sourceRevision`: a real torn state, at iteration 34), the pool-of-3 run, and both deterministic tests. **Variant B passed without the lock** (masked by the revision check), and a first version of the deterministic tests passed vacuously because supertest requests are lazy (`.then()` starts them): fixed, and found only because the lock-less run did not fail.

**Mutation proofs** (strictly sequential, each applied to the real source, the release/public/matrix/convention/trigger tests run (262 tests, all green before each), the file restored and its sha256 verified; mutation (e) drops the trigger in the test database and re-creates it from the migration, verified in `pg_trigger`):

| | Mutation | Failing tests |
|---|---|---|
| a | skip the `validateDraft` gate | 3 (tier violation, `EMPTY_DRAFT`, `RELEASE_TOO_LARGE`) |
| b | skip the `expectedRevision` check | 3 (stale-revision test, both race variants) |
| c | compute the release number before the lock | 1 (deterministic test (i)) |
| d | the public endpoint serves PRIVATE brands | 7 (byte-identical 404 css and json, the 404 pair, the owner-session test, the flip test, the private-by-default test, the public convention test) |
| e | drop the immutability trigger in the test DB | 8 (all trigger tests) |
| f | drop the CORP header on public routes | 7 (css and json success headers, both 304 tests, both byte-identical 404 tests, the 429 test) |
| g | a PRIVATE brand answers a different 404 than a missing one | 4 (both byte-identical 404 tests, the flip test, the public convention test) |
| h | read the draft rows before the lock | 2 (variant B, deterministic test (ii)) |

Reading the table honestly: **(a) is partly masked on purpose**: the build fails closed, so an alias to a missing token (`resolve`) and an empty stylesheet are refused even without the gate, with the same codes; the gate is what stops a tier violation, an oversized draft and an empty draft, which is what those three tests pin. **(c) and (h) are masked in the stress tests** (the unique constraint, the revision check) and caught only by the deterministic lock-hold tests ((h) is also caught by variant B in this run, not in every run). (b) is caught by the stale-revision test and by the race variants.

**Final run of the whole definition of done** (local, then again from a clean copy of the tree with a fresh `postgres:17` container and the CI environment variables, mirroring `.github/workflows/ci.yml`): `pnpm install --frozen-lockfile` with no ignored-build-scripts error, the migrations apply to a fresh database (`db:reset --yes`; both `init` and `release_immutable`), `db:drift` reports no difference (the trigger is invisible to it, as stated), `generate:theme` twice with no diff, typecheck, lint and format clean, tests **tokens-core 554, ui 496, api 1224** (43 files; was 552 / 496 / 1045), build, `smoke:api` with no `.env` and no database (`/ready` is 503), Storybook build.

**End-to-end browser tests: not green with the default parallelism on this machine, and not caused by this phase.** `pnpm test:e2e` (434 tests) passed 433 and failed 1 in each of three runs (a different test each time: `forcedColors` checkbox, `dialog` inert, `reducedMotion` button; every failure is the same 30 s timeout waiting for the Storybook preview iframe, `body.sb-show-main`, not an assertion). The same suite on a clean clone of the **previous commit** (Phase 3c, none of these changes) failed 2 and passed 432, so the cause is load on a 4-core development machine with the default 4 workers (`retries: 0` is deliberate, ADR 0010). With `--workers=2` all **434 passed**. The suite was not changed; `packages/ui` was not touched in this phase. CI's runner is not measured here.
