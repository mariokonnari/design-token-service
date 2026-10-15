import { Button, Dialog } from '@dts/ui'
import { useState } from 'react'
import { useApi } from '../../ApiContext'
import { withoutToken } from '../../editor/cache'
import { useTokenCache } from '../../editor/useTokens'
import { describeTokenError } from '../../forms/describeError'
import { useAnnounce } from '../Announcer'

/**
 * Deleting one draft token: a confirmation in OUR Dialog (never window.confirm),
 * then DELETE with the version the token was loaded with. A stale version (someone
 * changed it) is explained, not forced.
 */
export function useDeleteToken({
  organizationId,
  brandId,
  path,
  version,
  onDeleted,
}: {
  organizationId: string
  brandId: string
  path: string
  version: number
  onDeleted: () => void
}) {
  const api = useApi()
  const announce = useAnnounce()
  const cache = useTokenCache(organizationId, brandId)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      const { draftRevision } = await api.deleteToken(
        organizationId,
        brandId,
        path,
        version,
      )
      setOpen(false)
      cache.update(
        (list) => withoutToken(list, path, draftRevision),
        draftRevision,
      )
      announce(`Deleted ${path}, revision ${draftRevision}`)
      onDeleted()
    } catch (thrown) {
      setOpen(false)
      const failure = describeTokenError(thrown)
      if (failure.kind === 'conflict' || failure.kind === 'gone') {
        setError(
          'This token changed since you loaded it, so it was not deleted. The list has been reloaded; look at the latest version and try again.',
        )
        void cache.reload()
      } else if (failure.kind === 'other') {
        setError(failure.form)
      } else {
        setError('The token could not be deleted. Try again.')
      }
    } finally {
      setPending(false)
    }
  }

  return { open, setOpen, pending, error, confirm }
}

export function DeleteDialog({
  path,
  state,
}: {
  path: string
  state: ReturnType<typeof useDeleteToken>
}) {
  return (
    <Dialog
      open={state.open}
      onOpenChange={state.setOpen}
      title="Delete token?"
      // One short line on purpose: axe cannot decide the contrast of WRAPPED text inside a
      // modal dialog on this page ("partially obscured"), so the copy is kept to one line (ADR 0017).
      description="This removes it from the draft only."
    >
      <p>
        <strong>{path}</strong>
      </p>
      <div className="actions">
        <Button
          disabled={state.pending}
          onClick={() => {
            void state.confirm()
          }}
        >
          Yes, delete
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            state.setOpen(false)
          }}
        >
          Keep token
        </Button>
      </div>
    </Dialog>
  )
}
