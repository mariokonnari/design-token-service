import { ThemeScope } from '@dts/ui'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { Route, Routes } from 'react-router'
import { ApiProvider } from './ApiContext'
import type { Endpoints } from './api/endpoints'
import { GuestOnly, RequireAuth } from './auth/RequireAuth'
import { Shell } from './components/Shell'
import { BrandPage } from './pages/BrandPage'
import { BrandsPage } from './pages/BrandsPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OrgsPage } from './pages/OrgsPage'
import { SignupPage } from './pages/SignupPage'

/**
 * Providers and routes. The router itself (BrowserRouter in main.tsx, MemoryRouter
 * in tests), the API and the query client are injected so tests can run the whole
 * app on a fake fetch (ADR 0016). The app is wrapped in the default theme: every
 * color, size and font in it comes from the @dts/ui theme variables.
 */
export function App({
  api,
  queryClient,
}: {
  api: Endpoints
  queryClient: QueryClient
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <ThemeScope theme="default" className="app-root">
          <Routes>
            <Route element={<Shell />}>
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route path="/" element={<OrgsPage />} />
                <Route path="/orgs/:orgId" element={<BrandsPage />} />
                <Route
                  path="/orgs/:orgId/brands/:brandId"
                  element={<BrandPage />}
                />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ThemeScope>
      </ApiProvider>
    </QueryClientProvider>
  )
}
