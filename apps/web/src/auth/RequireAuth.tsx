import { Navigate, Outlet, useLocation } from 'react-router'
import { Loading, QueryError } from '../components/QueryError'
import { PageHeading } from '../components/PageHeading'
import { loginPathFor, safeNext } from './safeNext'
import { useMe } from './me'
import { useSearchParams } from 'react-router'

/**
 * Wraps every page that needs a session. It asks /api/me (once; the answer is
 * shared with the header and the login page through the query cache):
 *  - nobody signed in -> /login?next=<the page they wanted> (replace, so Back does
 *    not return to a page that would only redirect again);
 *  - the check itself failed (network, 5xx) -> an error with a retry, NOT a redirect:
 *    sending someone to /login because the Wi-Fi blinked would lose their place.
 */
export function RequireAuth() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) return <Loading>Checking your session…</Loading>
  if (me.isError) {
    return (
      <>
        <PageHeading title="Cannot check your session" />
        <QueryError
          error={me.error}
          onRetry={() => {
            void me.refetch()
          }}
        />
      </>
    )
  }
  if (me.data === null) {
    return <Navigate to={loginPathFor(location)} replace />
  }
  return <Outlet />
}

/**
 * The pages for people who are NOT signed in (login, signup): someone who already
 * is goes straight to where `next` says (a safe same-origin path) or home.
 */
export function GuestOnly() {
  const me = useMe()
  const [params] = useSearchParams()

  if (me.isPending) return <Loading>Loading…</Loading>
  if (me.data !== null && me.data !== undefined) {
    return <Navigate to={safeNext(params.get('next'))} replace />
  }
  return <Outlet />
}
