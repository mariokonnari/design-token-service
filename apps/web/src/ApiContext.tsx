import { createContext, useContext, type ReactNode } from 'react'
import type { Endpoints } from './api/endpoints'

const ApiContext = createContext<Endpoints | null>(null)

/** Hands the typed API calls to the screens; tests give it a fake-fetch client. */
export function ApiProvider({
  api,
  children,
}: {
  api: Endpoints
  children: ReactNode
}) {
  return <ApiContext value={api}>{children}</ApiContext>
}

export function useApi(): Endpoints {
  const api = useContext(ApiContext)
  if (api === null) throw new Error('useApi must be used inside <ApiProvider>')
  return api
}
