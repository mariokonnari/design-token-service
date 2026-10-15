import { Alert, Button, Dialog } from '@dts/ui'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router'
import { useApi } from '../../ApiContext'
import type { Brand, Organization } from '../../api/types'
import { buildListItems } from '../../editor/groups'
import { libraryCoverage } from '../../editor/libraryCoverage'
import { buildPreviewCss } from '../../editor/preview'
import { STARTER_TOKENS, STARTER_TREE } from '../../editor/starter'
import { parseTokenParam } from '../../editor/tokenParam'
import { useTokenCache, useTokenList } from '../../editor/useTokens'
import { workingTokens, type Overlay } from '../../editor/workingCopy'
import { describeTokenError } from '../../forms/describeError'
import { canEditTokens, roleLabel, visibilityLabel } from '../../roles'
import { useAnnounce } from '../Announcer'
import { Loading, QueryError } from '../QueryError'
import { DraftCheck } from './DraftCheck'
import { PreviewGallery, PreviewStyle } from './PreviewGallery'
import { ReadOnlyToken, TokenNotFound, UnreadableToken } from './StaticPanels'
import { TokenList } from './TokenList'
import { TokenPanel, type DraftChange } from './TokenPanel'

type Target =
  { kind: 'token'; path: string } | { kind: 'new' } | { kind: 'none' }

const NO_DRAFT: DraftChange = {
  candidate: undefined,
  isNew: false,
  dirty: false,
}

interface Notice {
  variant: 'success' | 'warning' | 'danger'
  title: string
  text: string
}

/**
 * The Theme Editor for one brand (ADR 0017): the draft's tokens (list, search, tier
 * tabs), the form for the selected one, the server's draft check, and a live preview
 * of the working copy against the @dts/ui components.
 *
 * The selected token is `?token=<path>` (deep links, reload); that value is never
 * trusted (parseTokenParam). At most ONE token is edited at a time: choosing another
 * while there are unsaved edits asks "Discard changes?" in our Dialog. Leaving the
 * page (browser Back, a link elsewhere, closing the tab) with unsaved edits is NOT
 * guarded in v1.
 */
export function Editor({ org, brand }: { org: Organization; brand: Brand }) {
  const organizationId = org.id
  const brandId = brand.id
  const canEdit = canEditTokens(org.role)
  const api = useApi()
  const announce = useAnnounce()
  const cache = useTokenCache(organizationId, brandId)
  const tokens = useTokenList(organizationId, brandId)
  const [params, setParams] = useSearchParams()

  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<DraftChange>(NO_DRAFT)
  const [pendingTarget, setPendingTarget] = useState<Target | undefined>()
  const [autoCheck, setAutoCheck] = useState(0)
  const [focusPath, setFocusPath] = useState<string | undefined>()
  const [notice, setNotice] = useState<Notice | undefined>()
  const [starting, setStarting] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const listHeading = useRef<HTMLHeadingElement>(null)
  // After a delete, focus goes to the list heading, but only once the panel and its
  // dialog are gone: closing a native dialog hands focus back to the button that
  // opened it, which would otherwise undo ours (seen in a real browser, not in jsdom).
  const [focusList, setFocusList] = useState(0)
  const focusListPending = useRef(false)

  const data = tokens.data
  const entries = useMemo(() => data?.entries ?? [], [data])
  const unreadable = useMemo(() => data?.unreadable ?? [], [data])
  const saved = useMemo(() => entries.map((entry) => entry.token), [entries])
  const entryBy = useMemo(
    () => new Map(entries.map((entry) => [entry.token.path, entry])),
    [entries],
  )
  const unreadableBy = useMemo(
    () => new Map(unreadable.map((row) => [row.path, row])),
    [unreadable],
  )
  const items = useMemo(
    () => buildListItems(saved, unreadable),
    [saved, unreadable],
  )
  const coverage = useMemo(
    () => libraryCoverage(saved, STARTER_TOKENS),
    [saved],
  )

  // The working copy = the saved tokens + the one edit in progress (if it is valid).
  const working = useMemo(() => {
    const overlay: Overlay =
      draft.candidate === undefined
        ? new Map()
        : new Map([
            [
              draft.candidate.path,
              { kind: draft.isNew ? 'add' : 'edit', token: draft.candidate },
            ],
          ])
    return workingTokens(entries, overlay)
  }, [entries, draft])
  const deferredWorking = useDeferredValue(working)
  const previewCss = useMemo(
    () => buildPreviewCss(deferredWorking).css,
    [deferredWorking],
  )

  const selection = parseTokenParam(params.get('token'))
  const hasSelection = selection.kind !== 'none' || creating
  useEffect(() => {
    if (focusListPending.current && !hasSelection) {
      focusListPending.current = false
      listHeading.current?.focus()
    }
  }, [focusList, hasSelection])
  const revision = data?.draftRevision ?? brand.draftRevision

  const go = useCallback(
    (target: Target) => {
      setNotice(undefined)
      if (target.kind === 'token') {
        setCreating(false)
        setParams({ token: target.path })
      } else {
        setCreating(target.kind === 'new')
        setParams({})
      }
    },
    [setParams],
  )
  const request = useCallback(
    (target: Target) => {
      if (draft.dirty) setPendingTarget(target)
      else go(target)
    },
    [draft.dirty, go],
  )
  const selectPath = useCallback(
    (path: string) => {
      request({ kind: 'token', path })
    },
    [request],
  )

  async function startFromDefault() {
    if (starting) return
    setStarting(true)
    setNotice(undefined)
    try {
      const result = await api.importTokens(organizationId, brandId, {
        tree: STARTER_TREE,
        expectedRevision: revision,
      })
      cache.setRevision(result.draftRevision)
      await cache.reload()
      const warnings =
        result.warnings.length === 0
          ? ''
          : ` ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'} came with it; the draft check lists them.`
      const text = `Imported ${result.count} tokens from the default theme.${warnings}`
      setNotice({ variant: 'success', title: 'Default theme imported', text })
      announce(`Default theme imported, ${result.count} tokens`)
      setAutoCheck((count) => count + 1)
    } catch (thrown) {
      const failure = describeTokenError(thrown)
      if (failure.kind === 'revisionConflict') {
        void cache.reload()
        setNotice({
          variant: 'warning',
          title: 'Nothing was imported',
          text: 'The draft changed while you were deciding. The tokens have been reloaded; look at them and try again.',
        })
      } else {
        setNotice({
          variant: 'danger',
          title: 'Could not import the default theme',
          text:
            failure.kind === 'other'
              ? failure.form
              : 'The default theme could not be imported.',
        })
      }
    } finally {
      setStarting(false)
    }
  }

  if (tokens.isPending) return <Loading>Loading tokens…</Loading>
  if (tokens.isError) {
    return (
      <QueryError
        error={tokens.error}
        onRetry={() => {
          void tokens.refetch()
        }}
      />
    )
  }

  const empty = entries.length === 0 && unreadable.length === 0

  let panel: ReactNode = null
  if (creating && canEdit) {
    panel = (
      <TokenPanel
        key="new"
        organizationId={organizationId}
        brandId={brandId}
        original={undefined}
        version={undefined}
        allTokens={saved}
        focusHeading={false}
        onDraft={setDraft}
        onSaved={(info) => {
          setAutoCheck((count) => count + 1)
          setFocusPath(info.path)
          setCreating(false)
          setParams({ token: info.path })
        }}
        onDeleted={() => undefined}
        onCancelNew={() => {
          setCreating(false)
        }}
      />
    )
  } else if (selection.kind === 'path') {
    const entry = entryBy.get(selection.path)
    const row = unreadableBy.get(selection.path)
    if (entry !== undefined) {
      panel = canEdit ? (
        <TokenPanel
          key={selection.path}
          organizationId={organizationId}
          brandId={brandId}
          original={entry.token}
          version={entry.version}
          allTokens={saved}
          focusHeading={focusPath === selection.path}
          onDraft={setDraft}
          onSaved={(info) => {
            setAutoCheck((count) => count + 1)
            if (info.created) {
              setFocusPath(info.path)
              setParams({ token: info.path })
            }
          }}
          onDeleted={() => {
            setAutoCheck((count) => count + 1)
            go({ kind: 'none' })
            focusListPending.current = true
            setFocusList((count) => count + 1)
          }}
          onCancelNew={() => undefined}
        />
      ) : (
        <ReadOnlyToken entry={entry} />
      )
    } else if (row !== undefined) {
      panel = (
        <UnreadableToken
          organizationId={organizationId}
          brandId={brandId}
          row={row}
          canEdit={canEdit}
          onDeleted={() => {
            setAutoCheck((count) => count + 1)
            go({ kind: 'none' })
            focusListPending.current = true
            setFocusList((count) => count + 1)
          }}
        />
      )
    } else {
      panel = <TokenNotFound />
    }
  } else if (selection.kind === 'invalid') {
    panel = <TokenNotFound />
  }

  const selectedPath = selection.kind === 'path' ? selection.path : undefined
  const missingId = 'missing-library-tokens'

  return (
    <>
      <dl className="details details--inline">
        <div>
          <dt>Slug</dt>
          <dd>{brand.slug}</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{visibilityLabel(brand.visibility)}</dd>
        </div>
        <div>
          <dt>Your role</dt>
          <dd>{roleLabel(org.role)}</dd>
        </div>
        <div>
          <dt>Draft revision</dt>
          <dd>{revision}</dd>
        </div>
      </dl>

      <div className="coverage">
        <p>
          Library tokens defined: {coverage.defined} of {coverage.total}
        </p>
        {coverage.missing.length === 0 ? null : (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={showMissing}
            aria-controls={missingId}
            onClick={() => {
              setShowMissing((open) => !open)
            }}
          >
            {showMissing
              ? 'Hide missing library tokens'
              : 'Show missing library tokens'}
          </Button>
        )}
      </div>
      <div id={missingId}>
        {showMissing ? (
          <ul aria-label="Missing library tokens" className="issue-list">
            {coverage.missing.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="editor__columns">
        <div
          role="group"
          aria-label="Tokens and editing"
          className="editor__main"
        >
          {canEdit ? null : (
            <Alert variant="info" title="Read only">
              <p>
                Your role in this organization ({roleLabel(org.role)}) can look
                at tokens but not change them.
              </p>
            </Alert>
          )}
          {notice === undefined ? null : (
            <Alert variant={notice.variant} title={notice.title}>
              <p>{notice.text}</p>
            </Alert>
          )}
          {empty && !creating ? (
            <section aria-labelledby="empty-heading" className="panel">
              <h2 id="empty-heading">Empty draft</h2>
              <p>This draft has no tokens yet.</p>
              {canEdit ? (
                <div className="actions">
                  <Button
                    disabled={starting}
                    onClick={() => {
                      void startFromDefault()
                    }}
                  >
                    Start from the default theme
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      request({ kind: 'new' })
                    }}
                  >
                    Create token
                  </Button>
                </div>
              ) : null}
            </section>
          ) : (
            <TokenList
              items={items}
              selectedPath={selectedPath}
              canCreate={canEdit}
              headingRef={listHeading}
              query={query}
              onQueryChange={setQuery}
              onSelect={selectPath}
              onCreate={() => {
                request({ kind: 'new' })
              }}
            />
          )}
          {panel}
          <DraftCheck
            organizationId={organizationId}
            brandId={brandId}
            revision={revision}
            autoCheck={canEdit ? autoCheck : 0}
            onSelect={selectPath}
          />
        </div>
        <div className="editor__side">
          <PreviewGallery />
        </div>
      </div>

      <PreviewStyle css={previewCss} />

      <Dialog
        open={pendingTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingTarget(undefined)
        }}
        title="Discard changes?"
        // One short line on purpose (see DeleteDialog).
        description="Your unsaved edits will be lost."
      >
        <div className="actions">
          <Button
            onClick={() => {
              const target = pendingTarget
              setPendingTarget(undefined)
              if (target !== undefined) go(target)
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPendingTarget(undefined)
            }}
          >
            Keep editing
          </Button>
        </div>
      </Dialog>
    </>
  )
}
