import '@dts/ui/themes.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { createApiClient } from './api/client'
import { createEndpoints } from './api/endpoints'
import { App } from './App'
import { handleAuthExpired } from './auth/me'
import { createQueryClient } from './queryClient'
import './styles/app.css'

const queryClient = createQueryClient()
const api = createEndpoints(
  createApiClient({
    // The one reaction to "your session ended" (a 401 anywhere), see auth/me.ts.
    onAuthExpired: () => {
      handleAuthExpired(queryClient)
    },
  }),
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App api={api} queryClient={queryClient} />
    </BrowserRouter>
  </StrictMode>,
)
