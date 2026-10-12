import { Link } from 'react-router'
import { PageHeading } from './PageHeading'

/**
 * "Not found" for an organization, a brand or a page. It is the same screen for a
 * thing that does not exist, one in another organization and a malformed id: the
 * API answers all of those with one 404 on purpose (ADR 0013), and the screen must
 * not tell them apart either.
 */
export function NotFoundBlock({
  title,
  children,
}: {
  title: string
  children: string
}) {
  return (
    <div className="page page--narrow">
      <PageHeading title={title} />
      <p>{children}</p>
      <p>
        <Link className="link" to="/">
          Go to your organizations
        </Link>
      </p>
    </div>
  )
}
