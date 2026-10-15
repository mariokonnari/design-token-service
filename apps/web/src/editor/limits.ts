/**
 * A documented LOCAL COPY of the API's limits (apps/api/src/tokens/validateWrite.ts
 * `LIMITS`, treeGuard.ts `RESERVED_NAMES`), so the editor can say "too long" before
 * a request. The server stays authoritative: if these drift, the cost is a server
 * 400 with its own message, never wrong data (ADR 0017).
 */
export const LIMITS = {
  maxPathLength: 200,
  /** Bytes of the JSON-encoded value. */
  maxValueBytes: 8192,
  maxDescriptionLength: 500,
  maxTokens: 2000,
} as const

/** Names that are refused anywhere in a token path (they would be dangerous object keys). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
])
