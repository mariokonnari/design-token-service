import { createContext, useContext, useState, type ReactNode } from 'react'

/**
 * A polite live region, mounted from the start and left empty, that announces
 * where the person is after they navigate (a single-page app does not reload, so a
 * screen reader would otherwise say nothing). Changing the text of an already
 * mounted region is what makes assistive technology read it (see the note in
 * @dts/ui's Alert).
 */
const AnnounceContext = createContext<(message: string) => void>(() => {
  // no announcer mounted (tests of single components): nothing to do
})

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  return (
    <AnnounceContext value={setMessage}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-label="Page changes"
        className="visually-hidden"
      >
        {message}
      </div>
    </AnnounceContext>
  )
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext)
}
