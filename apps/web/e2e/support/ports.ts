/**
 * Ports and origins of the real-stack e2e suite (ADR 0016). Dedicated numbers, not
 * 3000/5173: the suite starts its OWN servers and never reuses a running one
 * (`reuseExistingServer: false`), so it can never talk to a development API or
 * database. Shared by playwright.config.ts and the specs.
 */
export const API_PORT = 3100
export const WEB_PORT = 4173
export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
