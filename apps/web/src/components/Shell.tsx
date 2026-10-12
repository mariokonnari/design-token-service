import { Alert, Button } from '@dts/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useApi } from '../ApiContext'
import { signedOut, useMe } from '../auth/me'
import { AnnouncerProvider } from './Announcer'
import { APP_NAME } from './PageHeading'

/**
 * The frame around every page: a skip link (the first tab stop), the header with
 * the signed-in person and Log out, and <main id="main"> where the page goes. The
 * pages bring their own single h1 (PageHeading), so the frame has none.
 */
export function Shell() {
  const api = useApi()
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [logoutFailed, setLogoutFailed] = useState(false)
  const user = me.data ?? null

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onMutate: () => {
      setLogoutFailed(false)
    },
    onSuccess: () => {
      // Go to the login page FIRST, so ending the session does not also make
      // RequireAuth remember the page we were on as ?next=.
      void navigate('/login', { replace: true })
      signedOut(queryClient)
    },
    // The cookie is still valid: stay signed in and say so.
    onError: () => {
      setLogoutFailed(true)
    },
  })

  return (
    <AnnouncerProvider>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <span className="app-name">{APP_NAME}</span>
        {user === null ? null : (
          <nav aria-label="Account" className="app-account">
            <span>{user.email}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate()
              }}
            >
              Log out
            </Button>
          </nav>
        )}
      </header>
      {logoutFailed ? (
        <div className="app-notice">
          <Alert variant="danger" title="Could not log you out">
            <p>Your session is still active. Try again.</p>
          </Alert>
        </div>
      ) : null}
      <main id="main" tabIndex={-1} className="app-main">
        <Outlet />
      </main>
    </AnnouncerProvider>
  )
}
