# 0013. Authentication, sessions, organization membership and the HTTP layer

- Status: Accepted
- Date: 2026-10-08
- Builds on: [0012](0012-data-model-and-tenancy.md)
- Amended in Phase 4a ([0016](0016-web-app-foundation.md)): for local web development `ALLOWED_ORIGINS` must include `http://localhost:5173` (the Vite dev server). The browser sends that `Origin` and the Vite proxy forwards it unchanged, so the CSRF check in this ADR is exercised exactly as in production and still no CORS headers exist. A missing entry shows up as a 403 on every sign-up, login and create.

## Context

`apps/api` had a data layer (ADR 0012) but no way to know who is calling. Phase 3b adds accounts, sessions, organization membership and the HTTP layer around them. The deployment target (to be verified in Phase 6) is a browser app served from one origin that proxies API calls, so cookies can be same-site and no CORS is needed. The API holds password hashes and decides which tenant a caller may touch, so the cost of a mistake is a cross-tenant leak or an account takeover.

## Decision

### Sessions: a signed cookie, verified against the database on every request

The session is an **HS256 JWT in an `HttpOnly` cookie** (`jose` 6). The claims are `sub` (user id), `sv` (the user's session version), `iat`, `exp` (7 days), `iss` and `aud`. On **every** request the middleware verifies the token, **loads the user and compares `sv` with the stored `sessionVersion`**. So a token is not self-sufficient: logout-all and a password change bump the version and revoke every token instantly, and a deleted account stops working at once.

- **Verification pins the algorithm** (`algorithms: ['HS256']`), requires every claim, and returns `null` (never throws) for anything else. Tested with: expired (to the second), wrong issuer, wrong audience, wrong secret, tampered payload and signature, `alg: none` with and without a signature, `None`, an empty or missing algorithm, an `RS256` header, an embedded `jwk`, **HS512 with a valid signature**, a missing or non-integer `sv`, a subject that is not a uuid, a lifetime over 7 days, an `iat` in the future, and junk up to a 100 KB token. Tokens over 1 KB are refused before parsing.
- **Cookie:** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 7 days, no `Domain`. In **production only** the name is `__Host-dts_session` and the cookie is `Secure` (the browser then refuses it unless it is `Secure`, `Path=/` and has no `Domain`, so a sibling subdomain cannot plant or overwrite it). In production the unprefixed name is **ignored**. Two cookies with our name are treated as no session (cookie tossing). Clearing uses the same attributes, which a `__Host-` cookie requires.
- **Any authentication failure is the same 401** with a generic body and a cleared cookie; the reason is never given. A database error is a **500**, not a 401.

### Passwords: scrypt, with a concurrency cap

OWASP's current guidance ranks Argon2id first and scrypt as the fallback; Node ships scrypt and not Argon2, so scrypt it is. All five OWASP parameter sets are meant to be equivalent. Measured on a developer machine (8 CPUs), one hash and four at once:

| Parameters | Memory per hash | One hash | 4 at once | Peak RSS |
|---|---|---|---|---|
| N=2^17, r=8, p=1 | 128 MiB | 328 ms | 403 ms | 549 MiB |
| **N=2^16, r=8, p=2 (chosen)** | **64 MiB** | **285 ms** | 384 ms | 293 MiB |
| N=2^15, r=8, p=3 (documented fallback) | 32 MiB | 208 ms | 256 ms | 165 MiB |

- Memory per concurrent hash is **exactly** the theoretical figure, and Node's default `maxmem` (32 MiB) rejects anything above N=2^15, so `maxmem` is set from the parameters.
- **At most 2 hashes run at once, with a bounded queue of 32; beyond that the request gets a 503 immediately.** On a 512 MB server that is about 128 MiB of scrypt memory on top of the process, and libuv's 4-thread pool (shared with fs and dns) keeps two threads free.
- **Stored format** (self-describing): `scrypt$N=65536,r=8,p=2$<salt>$<key>` (base64url, 16-byte salt, 32-byte key). `needsRehash()` compares the stored parameters with the current ones; a successful login upgrades the hash with a **compare-and-set that does not bump the session version** (other sessions stay valid and a concurrent password change is never overwritten).
- **Every stored hash is bounded before use** (N a power of two from 2^10 to 2^17, r ≤ 16, p ≤ 16, N·r ≤ 2^20 i.e. 128 MiB, canonical base64, exact lengths). A malformed or hostile string (including `N=2^30`) returns "no match" at once (the test allows 200 ms and checks that memory does not grow), derives nothing and never throws.
- **Policy:** 12 to 128 characters (code points), **NFKC-normalized** (NIST SP 800-63B) before hashing, **no composition rules**. A password over 4096 characters is refused before it is normalized. There is no breached-password check.
- **Comparison is constant-time** (`timingSafeEqual`). **Unknown emails run a dummy verify** with a hash made at startup with the current parameters, so a login costs one hash whether or not the account exists (tests count key derivations: exactly one in all three cases).

### Enumeration: signup reveals, login does not

- **Login** gives the same generic 401 (`INVALID_CREDENTIALS`) for a wrong password and an unknown email, with the same cost and the same response headers.
- **Signup returns 409 `EMAIL_TAKEN`**, which reveals that an address is registered. That is a deliberate trade-off: the alternative (always "check your email") needs email verification, which does not exist yet. The signup limiter bounds how fast it can be probed.
- A concurrent duplicate signup is decided by the **unique constraint**, not by a check-then-insert: 16 simultaneous signups with one email gave exactly one 201 and 15 409s, never a 500 (also repeated in rounds).

### CSRF: three independent layers, no CORS

1. **`SameSite=Lax`** on the cookie.
2. **An `Origin` check** on every unsafe method (POST, PUT, PATCH, DELETE): the header must be **exactly** one of `ALLOWED_ORIGINS`. A missing header, `null`, a different scheme, case, trailing slash, subdomain or prefix is refused (403). It runs before the body is parsed. An empty allowlist refuses every unsafe request. **Non-browser clients must send an `Origin` header too.**
3. **JSON-only bodies:** an unsafe request with a body must be `application/json` (415 otherwise), which a cross-site HTML form cannot send.

**No CORS headers at all** (no `cors` middleware): the deployment is same-origin, so a cross-origin preflight is answered like any unknown request and carries no `Access-Control-*` header (tested, including on normal responses). Enabling CORS later would be a deliberate decision, not a default.

### Validation: strict bodies, validated path parameters

Every request body is parsed with a **strict zod schema** (`z.strictObject`): an unknown key is a 400, so `role`, `userId`, `organizationId`, `isAdmin`, `sessionVersion`, `passwordHash` or a `__proto__` key can never reach a handler (tested on signup, login, change-password, organization creation and member PATCH). Routes that take no body reject one. Path parameters are validated as UUIDs and a malformed one is a **404**, exactly like an id that matches nothing (no 400-versus-404 oracle). zod messages carry field names and fixed texts, never the submitted value.

### The HTTP layer

- **One central error handler**: every failure is `{ "error": { "code", "message" } }`, nothing else. Typed errors carry their own status and code (403, 409, 400, 401, 404, 429, 503, 415); body-parser and zod errors are mapped (413 `PAYLOAD_TOO_LARGE`, 400 `INVALID_JSON`, 400 `VALIDATION_ERROR`); anything else is a generic **500** with no stack, no path and no message. Unknown errors are logged server-side with the request id.
- **The request id is not in the error body.** It travels in the `X-Request-Id` header and in the logs. This keeps error bodies identical where they must be (the cross-tenant matrix compares them byte for byte).
- **Request ids are never taken raw.** An incoming `X-Request-Id` is used only if it matches `^[A-Za-z0-9-]{8,64}$`; anything else (newlines, quotes, forged JSON, 3000-character strings) is replaced by a fresh uuid. A hostile value is never written to a log.
- **Logging** (pino 10, pino-http 11) keeps secrets out in two independent layers: an **allowlist serializer** (the request id, method, the path **without** the query string, the remote address and a truncated user agent: never headers, cookies, bodies or the raw request id) and `redact` paths for cookie, authorization, set-cookie and every password field. A test sends a real login with a cookie and an authorization header and proves none of the values reach the log; another proves the `redact` layer on its own. The probes `/health` and `/ready` are not logged.
- helmet's defaults, `x-powered-by` off, a 16 KB JSON limit.
- **TRUST_PROXY** (an integer, default 0) is validated in the environment.

### Rate limiting

`express-rate-limit` 8 with the **in-memory store**, IETF `RateLimit` headers (draft-7), no legacy headers. **Every limiter runs before any hashing** (tests assert a blocked attempt costs zero key derivations):

| Route | Limiter | Default | Counts |
|---|---|---|---|
| login | per IP + normalized email | 10 / 15 min | failed attempts only |
| login | per IP | 60 / 15 min | all attempts |
| signup | per IP | 5 / hour | all attempts |
| change-password | per user | 5 / 15 min | all attempts |

The per-IP login limiter exists so that **rotating emails from one address still hits a ceiling** (tested). The key functions and the limits are injectable, so tests need no sleeping. IPv6 addresses are masked to a /56.

**The proxy pitfall.** `req.ip` is the real client only if `TRUST_PROXY` equals the number of proxies in front of the app. Too low and every user shares the proxy's address, so one bad actor blocks everyone (tested: with 0 behind a proxy a third, different client is blocked); too high and a client can forge `X-Forwarded-For` to dodge the limit. express-rate-limit logs, but does not throw, when it sees a forwarded header with `trust proxy` off.

### Organizations, membership and tenant scope

- `requireOrg` is **the only caller of `issueTenantScope`** (ESLint restricts the import to `src/auth`). It validates the organization id as a uuid, loads the caller's membership **from the database** and issues the scope with the **stored** role; nothing the client sends (a header, a query parameter, a body field) can change it.
- **404, not 403, across tenants.** A malformed id, an organization that does not exist and an organization the caller does not belong to are **indistinguishable**: the same 404, the same body, the same header names, one membership lookup each (a malformed id needs none). A **403** is only for a caller inside their own organization whose role is too low.
- **Roles are compared in one place**, `tenancy/policy.ts` (`assertAtLeast`, `canManageMembers`, `canRemoveMember`), and every role is tested.
- **The route table is the single source of truth** (`src/routes/table.ts`): each entry declares its method, full path, access (`public`, `authenticated` or `{ orgRole }`) and handler, and `createApp` mounts routes **only** from it. A protected route cannot be mounted without its guard (the app fails at startup). A guard test enumerates `app.router.stack` and fails on any mounted route that is not in the table, any `app.all`, any nested router, any route mounted after the error handlers and any unexpected middleware; it is proven against deliberately bad apps. **Express 5 cannot recover a nested router's mount prefix**, so the guard is only trustworthy if every route is registered at the top level with its full path; an ESLint rule confines `app.get/post/.../use` and `Router()` to two files. **`refinedBy`** names a policy function that narrows a route's declared access (the DELETE member route is open to every member, and `canRemoveMember` lets anyone remove themselves but only an owner remove others); a test checks that the name is a real policy function and that the route was exercised as every role, on self and on others.
- **The cross-tenant leak matrix** iterates the route table: every org-scoped route is called as a member of another organization, as an authenticated user with a random organization id (and a malformed one), and as nobody, expecting identical 404s and a 401. A route without a matrix case fails the test, and each HTTP method present among the org-scoped routes must be exercised.

### The last-owner invariant

An organization can never end up with zero owners. Every change that could reduce the owners runs in a **transaction that first locks the organization's OWNER rows** (`SELECT ... FOR UPDATE ORDER BY id`, so two transactions cannot deadlock) and decides from the **locked** rows: the actor's role is re-checked under the lock (a session whose owner was demoted a moment ago must not act with the role it just lost) and the last owner can neither be demoted nor removed (409 `LAST_OWNER`). Two defenses, both real: the fresh-role check refuses the loser of "A demotes B while B demotes A" with 403; the last-owner check refuses the loser of two owners leaving at once with 409.

**Tested with real concurrent requests against Postgres**, 30 iterations each, in seven shapes (each demotes the other, each removes the other, one demotes and one removes, both leave, both demote themselves, three owners in a cycle with demotion and with removal): exactly one of two succeeds, an owner always remains, no 5xx. **Mutation proof:** removing only `FOR UPDATE` while keeping every check made 6 of the 8 race tests fail.

*Note added in Phase 3c ([0014](0014-brands-and-draft-tokens.md)):* these owner races run **30** iterations each, not the 100 later used for the draft-token races (50 for the 8-request distinct-create scenario, 100 for the other three). The lower count was not revisited; the mutation proof above is what shows these tests detect a missing lock.

## Alternatives considered

- **Stateless JWT only** (no database lookup). Faster, but a stolen or old token stays valid until it expires and there is no logout-all or password-change revocation. Rejected: the user lookup per request is one indexed query and buys instant revocation.
- **Server-side sessions** (a `Session` table). Per-device revocation and an audit trail, at the cost of a table, cleanup and a lookup that is no cheaper than loading the user. The version counter gives "revoke everything" with no new table. The price is no per-device logout (see gaps). Revisit with device management.
- **`cookie-parser`** or hand parsing. Rejected: the `cookie` package's parser plus Express's own `res.cookie` is smaller, and the duplicate-cookie and prefix rules are ours anyway.
- **Argon2id** (OWASP's first choice). Needs a native dependency (blocked build scripts, ADR 0012); scrypt is built in.
- **Rate limits in Postgres or Redis.** Shared across instances and durable, but a new dependency and a query before hashing. In-memory is enough for one instance; it is a known gap.
- **Request id in the error body.** Convenient for users reporting a problem but it breaks byte-identical 404s; the header does the job.
- **Rejecting unknown JSON keys with a fixed error** versus stripping them: stripping silently accepts typos and probing; strict is safer.

## Consequences and honest gaps

- **Single-device logout only clears the cookie.** A captured token stays valid until it expires (7 days); only **logout-all and a password change revoke**. A test documents this behavior on purpose.
- **Hash-queue saturation can return 503 for every login** during an attack, because the hash queue is shared. The limiters reduce this, they do not remove it.
- **Credential stuffing across many IPs** is limited per IP and per (IP, email) only; there is no per-account lockout (which would itself be a denial-of-service lever).
- **The limiters are in-memory:** counters reset on restart and are per instance.
- **No email verification, password reset, MFA, invitations or audit log.** A signup needs no proof of owning the address. Members are added to an organization only by inserting rows today.
- **One signing secret, no rotation.** Changing `SESSION_SECRET` logs everyone out. Sessions have a fixed 7-day lifetime (not sliding).
- **The password parameters are not load-tested.** Latency on the real server's CPU is unmeasured.
- **A scope can be stale for the length of a request.** The membership operations re-check the actor under a lock; code that writes other data trusts the role from the start of the request.
- **Email handling is only trim-and-lowercase** (no Unicode or IDN normalization). The log contains the client IP and a truncated user agent, which are personal data.
- **Non-browser clients must send `Origin`**; a script with no header is refused.

### Phase 6 verifications (deployment): untested assumptions

1. **`TRUST_PROXY` is probably 2, not 1, behind Vercel then Render.** Verify on a real deployment by observing the actual forwarded chain before trusting a number; a wrong value either shares one limit between all users or lets clients forge their address.
2. **The `Origin` allowlist versus Vercel preview URLs:** every preview deployment has its own origin, so a fixed list will refuse them. Decide how previews are handled (a separate environment, or an explicit pattern) without weakening production.
3. **Whether Vercel's rewrite forwards `Origin` and `Set-Cookie` correctly** (and that the `__Host-` cookie survives a rewrite) is unverified.
4. **scrypt latency on Render's free CPU is unmeasured.** There is a **go/no-go gate before real users sign up**: measure a login on the deployed server and, if it is too slow or the queue saturates, switch to **N=2^15, r=8, p=3** (the documented fallback; the self-describing hash makes this a parameter change plus rehash-on-login).
5. The Supabase pooler and IPv4/IPv6 connectivity from Render with the `pg` adapter (ADR 0012).

## Verification summary

Each mutation below was applied to the real code, the relevant tests were run, and the file was restored with its hash verified.

| Mutation | Result |
|---|---|
| skip the Origin check | 24 tests fail |
| skip the session-version comparison | 6 fail |
| `requireOrg` answers 403 for non-members | 7 fail (the leak matrix among them) |
| remove the last-owner guard | 6 fail |
| remove only the row lock (`FOR UPDATE`), keep every check | 6 of 8 race tests fail |
| remove the content-type enforcement | 10 fail |
| drop `HttpOnly` from the cookie | 5 fail |
| skip the dummy hash for unknown emails | 2 fail |
