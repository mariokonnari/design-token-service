import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useAnnounce } from './Announcer'

export const APP_NAME = 'Design Token Service'

/**
 * The page's one h1. On mount it:
 *  - sets the document title ("<page> – Design Token Service"), which is what a
 *    screen reader announces on a real page load and what the tab shows;
 *  - after an in-app navigation, moves keyboard focus to itself and announces the
 *    page in the live region, so a keyboard or screen-reader user starts at the
 *    top of the new page instead of on a link that no longer exists.
 * It does NOT take focus on the very first load of the app (location key
 * "default"): the browser already starts at the top of a freshly loaded page.
 * (A skip-link jump to #main changes the location too, but does not mount a new
 * heading, so focus stays where the skip link put it.)
 */
export function PageHeading({
  title,
  children,
}: {
  /** Plain text for the document title and the announcement. */
  title: string
  /** What to show in the h1 when it is not just the title. */
  children?: ReactNode
}) {
  const location = useLocation()
  const announce = useAnnounce()
  const heading = useRef<HTMLHeadingElement>(null)
  const isFirstLoad = useRef(location.key === 'default')

  useEffect(() => {
    document.title = `${title} – ${APP_NAME}`
    if (!isFirstLoad.current) {
      heading.current?.focus()
      announce(title)
    }
  }, [title, announce])

  return (
    <h1 ref={heading} tabIndex={-1}>
      {children ?? title}
    </h1>
  )
}
