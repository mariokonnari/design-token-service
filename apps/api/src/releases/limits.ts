/**
 * Release storage caps (ADR 0015). Releases are immutable and there is no delete or
 * purge, so storage must be bounded up front.
 *
 * Measured on the development machine (scratch script, 2000 tokens):
 * - a realistic large brand (400 primitives, 800 semantic and 800 component aliases,
 *   short descriptions): snapshot 136 KB + CSS 55 KB = 191 KB;
 * - the worst case the per-token limits allow (2000 exported tokens with ~8 KB values
 *   and 500-character descriptions): 36 MB.
 * The size cap is ~5x the realistic release and rejects the worst case ~35x over.
 */
export const RELEASE_LIMITS = {
  /**
   * Snapshot bytes (JSON of the source tree) + CSS bytes (generated with the ROOT
   * scope, because validateDraft has no brand slug; the stored CSS is longer only by
   * the `[data-theme="<slug>"]` selector).
   */
  MAX_RELEASE_BYTES: 1_048_576,
  /** Releases per brand; checked under the brand lock. A brand at the cap cannot publish again. */
  MAX_RELEASES_PER_BRAND: 200,
} as const
