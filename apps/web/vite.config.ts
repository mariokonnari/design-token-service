import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The browser only ever talks to its OWN origin: `/api` is proxied to the API
 * (ADR 0016). That keeps the session cookie same-origin (SameSite=Lax, no
 * `Domain`), so the API needs no CORS (ADR 0013). The proxy forwards the
 * browser's `Origin` header untouched (`changeOrigin` stays false), so the API's
 * CSRF check sees exactly what it sees in production: that origin must be in the
 * API's ALLOWED_ORIGINS (http://localhost:5173 for local development).
 *
 * This is DEV/TEST tooling only. Production serves the built bundle from a host
 * that rewrites `/api/*` to the API (Phase 6, ADR 0013); nothing here ships.
 * `vite preview` uses the same proxy, which is how the real-stack e2e suite
 * serves the BUILT bundle with the same proxy behavior (e2e/README in ADR 0016).
 * API_PROXY_TARGET exists so that suite can point at its own API on another port.
 */
const proxy = {
  '/api': {
    target: process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000',
    changeOrigin: false,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // strictPort: ALLOWED_ORIGINS names exactly this origin, so silently moving to
  // another port would turn every write into a confusing 403.
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
})
