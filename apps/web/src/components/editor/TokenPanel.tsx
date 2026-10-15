import { Alert, Button, Select, TextField } from '@dts/ui'
import {
  TOKEN_TYPES,
  tokenFromParts,
  tokenToParts,
  type Token,
  type TokenType,
} from '@dts/tokens-core'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useApi } from '../../ApiContext'
import type { PutTokenInput } from '../../api/types'
import { withSavedToken } from '../../editor/cache'
import {
  emptyForm,
  formFromToken,
  tokenFromForm,
  type FormErrors,
  type FormField,
  type TokenForm,
} from '../../editor/form'
import { validateLocal } from '../../editor/validateLocal'
import { formatTokenValue } from '../../editor/values'
import { useTokenCache } from '../../editor/useTokens'
import { describeTokenError } from '../../forms/describeError'
import { useAnnounce } from '../Announcer'
import { FormErrorSummary } from '../FormErrorSummary'
import { DeleteDialog, useDeleteToken } from './DeleteToken'

const TYPE_LABEL: Record<TokenType, string> = {
  color: 'Color',
  dimension: 'Dimension',
  fontFamily: 'Font family',
  fontWeight: 'Font weight',
  number: 'Number',
}

const VALUE_HINT: Record<TokenType, string> = {
  color: 'For example #2563eb.',
  dimension: 'A size in px or rem, like 16px or 1.5rem.',
  fontFamily:
    'Font names separated by commas, like Inter, "Helvetica Neue", sans-serif.',
  fontWeight: 'A number from 1 to 1000, or a name like bold.',
  number: 'A decimal number, like 1.5.',
}

const FIELD_ID: Record<FormField, string> = {
  path: 'token-path',
  type: 'token-type',
  value: 'token-value',
  hex: 'token-hex',
  alpha: 'token-alpha',
  alias: 'token-alias',
  description: 'token-description',
}

const FIELD_ORDER: FormField[] = [
  'path',
  'type',
  'hex',
  'alpha',
  'value',
  'alias',
  'description',
]

type Conflict =
  | {
      kind: 'changed'
      /** The latest saved value as text, when it could be read again. */
      latestText: string | undefined
      latest: Token | undefined
      /** The version to overwrite. */
      version: number | undefined
    }
  | { kind: 'gone' }

function sameForm(a: TokenForm, b: TokenForm): boolean {
  return (Object.keys(a) as (keyof TokenForm)[]).every((k) => a[k] === b[k])
}

function toInput(
  token: Token,
  expectedVersion: number | undefined,
): PutTokenInput {
  const parts = tokenToParts(token)
  return {
    path: parts.path,
    ...(parts.type === null ? {} : { type: parts.type }),
    value: parts.value,
    ...(parts.description === null ? {} : { description: parts.description }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  }
}

export interface DraftChange {
  /** The token the form describes right now, when it is valid. */
  candidate: Token | undefined
  isNew: boolean
  dirty: boolean
}

/**
 * The form for ONE token: an existing one (`original`) or a new one. It owns the
 * form state; the editor around it learns only the candidate token (for the live
 * preview) and whether there are unsaved edits (for the discard prompt).
 *
 * One PUT per Save, with the version the token was loaded with. A 409 NEVER
 * overwrites silently: what was typed is kept, the latest saved value is shown,
 * and a second, explicit click ("Save over their version") is needed (ADR 0017).
 */
export function TokenPanel({
  organizationId,
  brandId,
  original,
  version,
  allTokens,
  focusHeading,
  onDraft,
  onSaved,
  onDeleted,
  onCancelNew,
}: {
  organizationId: string
  brandId: string
  /** The saved token being edited; undefined when creating. */
  original: Token | undefined
  version: number | undefined
  /** The saved tokens, for the local checks. */
  allTokens: readonly Token[]
  focusHeading: boolean
  onDraft: (change: DraftChange) => void
  onSaved: (saved: { path: string; created: boolean }) => void
  onDeleted: () => void
  onCancelNew: () => void
}) {
  const api = useApi()
  const announce = useAnnounce()
  const cache = useTokenCache(organizationId, brandId)
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const isNew = original === undefined

  const baseForm = useMemo(
    () => (original === undefined ? emptyForm() : formFromToken(original)),
    [original],
  )
  const [form, setForm] = useState<TokenForm>(baseForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [formMessage, setFormMessage] = useState<string | undefined>()
  const [requestId, setRequestId] = useState<string | undefined>()
  const [conflict, setConflict] = useState<Conflict | undefined>()
  const [pending, setPending] = useState(false)
  const busy = useRef(false)

  const [summary, attachSummary] = useState<HTMLDivElement | null>(null)
  const [focusRequests, setFocusRequests] = useState(0)
  useEffect(() => {
    if (focusRequests > 0) summary?.focus()
  }, [focusRequests, summary])

  useEffect(() => {
    if (focusHeading) heading.current?.focus()
  }, [focusHeading])

  const dirty = !sameForm(form, baseForm)
  const built = useMemo(() => tokenFromForm(form, original), [form, original])
  const candidate = built.ok ? built.token : undefined

  useEffect(() => {
    onDraft({ candidate, isNew, dirty })
  }, [candidate, isNew, dirty, onDraft])
  useEffect(
    () => () => {
      onDraft({ candidate: undefined, isNew: false, dirty: false })
    },
    [onDraft],
  )

  const local = useMemo(
    () =>
      candidate === undefined ? [] : validateLocal(candidate, allTokens, isNew),
    [candidate, allTokens, isNew],
  )
  const localBy = (field: FormField): string | undefined =>
    local.find((problem) => problem.field === field)?.message
  const general = local.filter(
    (problem) => problem.field === 'general' || problem.field === 'value',
  )
  const message = (field: FormField): string | undefined =>
    errors[field] ?? localBy(field)

  const del = useDeleteToken({
    organizationId,
    brandId,
    path: original?.path ?? '',
    version: version ?? 1,
    onDeleted,
  })

  function change(patch: Partial<TokenForm>) {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch) as FormField[]) delete next[key]
      return next
    })
  }

  function showFailure(
    fields: FormErrors,
    text: string | undefined,
    reference?: string,
  ) {
    setErrors(fields)
    setFormMessage(text)
    setRequestId(reference)
    setFocusRequests((count) => count + 1)
  }

  async function save(
    options: { overwrite?: number; recreate?: boolean } = {},
  ) {
    if (busy.current) return
    if (!built.ok) {
      showFailure(built.errors, undefined)
      return
    }
    const token = built.token
    const expectedVersion = options.recreate
      ? undefined
      : (options.overwrite ?? version)

    busy.current = true
    setPending(true)
    setErrors({})
    setFormMessage(undefined)
    setRequestId(undefined)
    try {
      const result = await api.putToken(
        organizationId,
        brandId,
        toInput(token, expectedVersion),
      )
      cache.update(
        (list) => withSavedToken(list, result.token, result.draftRevision),
        result.draftRevision,
      )
      announce(`Saved ${token.path}, revision ${result.draftRevision}`)
      setConflict(undefined)
      if (!isNew) {
        setForm(formFromToken(token))
        heading.current?.focus()
      }
      onSaved({ path: token.path, created: isNew || options.recreate === true })
    } catch (thrown) {
      await handleFailure(thrown, token)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function handleFailure(thrown: unknown, token: Token) {
    const failure = describeTokenError(thrown)
    switch (failure.kind) {
      case 'conflict': {
        const list = await cache.reload()
        const row = list?.tokens.find(
          (candidateRow) => candidateRow.path === token.path,
        )
        const latest =
          row === undefined
            ? undefined
            : tokenFromParts({
                path: row.path,
                type: row.type,
                value: row.value,
                description: row.description,
              })
        setConflict({
          kind: 'changed',
          latest: latest?.ok ? latest.token : undefined,
          latestText: latest?.ok ? formatTokenValue(latest.token) : undefined,
          version: failure.currentVersion ?? row?.version,
        })
        setFocusRequests((count) => count + 1)
        return
      }
      case 'gone':
        setConflict({ kind: 'gone' })
        return
      case 'pathConflict':
        showFailure(
          {
            path:
              failure.conflictsWith === undefined
                ? 'This path overlaps with another token.'
                : `This path overlaps with the existing token ${failure.conflictsWith}. A token cannot also be a group.`,
          },
          undefined,
        )
        return
      case 'limit':
        showFailure({}, 'This brand has reached its limit of 2000 tokens.')
        return
      case 'revisionConflict':
        showFailure({}, 'The draft changed while you were editing. Try again.')
        return
      case 'invalid': {
        const fields: FormErrors = {}
        const rest: string[] = []
        for (const issue of failure.issues) {
          const field = issue.field
          const target: FormField | undefined =
            field === 'path' || field === 'type' || field === 'description'
              ? field
              : field === 'value'
                ? 'type' in token && token.type === 'color'
                  ? 'hex'
                  : 'value'
                : undefined
          if (target !== undefined && fields[target] === undefined) {
            fields[target] = issue.message
          } else {
            rest.push(issue.message)
          }
        }
        showFailure(fields, rest[0])
        return
      }
      case 'other':
        showFailure({}, failure.form, failure.requestId)
    }
  }

  const summaryItems = FIELD_ORDER.flatMap((field) => {
    const text = errors[field]
    return text === undefined
      ? []
      : [{ fieldId: FIELD_ID[field], message: text }]
  })
  const hasProblems = summaryItems.length > 0 || formMessage !== undefined
  const isColor = form.mode === 'literal' && form.type === 'color'

  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        {isNew ? 'New token' : original.path}
      </h2>
      <form
        noValidate
        className="form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {hasProblems ? (
          <FormErrorSummary
            attach={attachSummary}
            items={summaryItems}
            message={formMessage}
            requestId={requestId}
          />
        ) : null}

        {conflict?.kind === 'changed' ? (
          <Alert
            variant="warning"
            title="This token changed since you loaded it"
          >
            <p>
              {conflict.latestText === undefined
                ? 'Someone else saved a different version. '
                : `The latest saved value is ${conflict.latestText}. `}
              What you typed is still in the form, and nothing was overwritten.
            </p>
            <div className="actions">
              <Button
                size="sm"
                disabled={pending || conflict.version === undefined}
                onClick={() => {
                  void save({ overwrite: conflict.version })
                }}
              >
                Save over their version
              </Button>
              {conflict.latest === undefined ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setForm(formFromToken(conflict.latest as Token))
                    setConflict(undefined)
                    setErrors({})
                  }}
                >
                  Use their version
                </Button>
              )}
            </div>
          </Alert>
        ) : null}
        {conflict?.kind === 'gone' ? (
          <Alert
            variant="warning"
            title="This token was deleted since you loaded it"
          >
            <p>What you typed is still in the form.</p>
            <div className="actions">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  void save({ recreate: true })
                }}
              >
                Create it again
              </Button>
            </div>
          </Alert>
        ) : null}

        <TextField
          id={FIELD_ID.path}
          label="Path"
          required
          readOnly={!isNew}
          description={
            isNew
              ? 'Dot-separated names of lowercase letters, digits and hyphens, starting with primitive, semantic or component.'
              : 'A path cannot be changed here.'
          }
          autoComplete="off"
          spellCheck={false}
          value={form.path}
          error={message('path')}
          onChange={(event) => {
            change({ path: event.target.value })
          }}
        />
        <Select
          id="token-kind"
          label="Kind"
          value={form.mode}
          onChange={(event) => {
            change({
              mode: event.target.value === 'alias' ? 'alias' : 'literal',
            })
          }}
        >
          <option value="literal">Literal value</option>
          <option value="alias">Alias of another token</option>
        </Select>
        <Select
          id={FIELD_ID.type}
          label={form.mode === 'alias' ? 'Type (optional)' : 'Type'}
          required={form.mode === 'literal'}
          value={form.type}
          error={message('type')}
          onChange={(event) => {
            const type = event.target.value as TokenType | ''
            change(
              form.mode === 'alias'
                ? { type }
                : { type, value: '', hex: '', alpha: '' },
            )
          }}
        >
          <option value="">
            {form.mode === 'alias' ? 'Same as the target' : 'Choose a type'}
          </option>
          {TOKEN_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </Select>

        {form.mode === 'alias' ? (
          <TextField
            id={FIELD_ID.alias}
            label="Alias target"
            required
            description="The path of another token, like primitive.color.blue-500. Braces are optional."
            autoComplete="off"
            spellCheck={false}
            value={form.alias}
            error={message('alias')}
            onChange={(event) => {
              change({ alias: event.target.value })
            }}
          />
        ) : isColor ? (
          <>
            <TextField
              id={FIELD_ID.hex}
              label="Color (hex)"
              required
              description="For example #2563eb or #fff."
              autoComplete="off"
              spellCheck={false}
              value={form.hex}
              error={errors.hex}
              onChange={(event) => {
                change({ hex: event.target.value })
              }}
            />
            <TextField
              id={FIELD_ID.alpha}
              label="Alpha (0 to 1)"
              description="Leave empty for fully opaque."
              autoComplete="off"
              value={form.alpha}
              error={errors.alpha}
              onChange={(event) => {
                change({ alpha: event.target.value })
              }}
            />
          </>
        ) : form.type === '' ? null : (
          <TextField
            id={FIELD_ID.value}
            label="Value"
            required
            description={VALUE_HINT[form.type]}
            autoComplete="off"
            spellCheck={false}
            value={form.value}
            error={errors.value}
            onChange={(event) => {
              change({ value: event.target.value })
            }}
          />
        )}

        <TextField
          id={FIELD_ID.description}
          label="Description"
          description="Optional. At most 500 characters."
          value={form.description}
          error={errors.description}
          onChange={(event) => {
            change({ description: event.target.value })
          }}
        />

        {general.length > 0 ? (
          <Alert variant="warning" title="Not complete yet">
            <ul className="issue-list">
              {general.map((problem) => (
                <li key={problem.message}>{problem.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {candidate !== undefined && local.length === 0 ? (
          <p className="muted" role="status">
            Looks valid here.
          </p>
        ) : null}
        {local.length > 0 ? (
          <p className="muted">
            You can still save: a draft may be incomplete. The draft check says
            what has to change before it can be published.
          </p>
        ) : null}

        <div className="actions">
          <Button type="submit" disabled={!dirty || pending}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setErrors({})
              setFormMessage(undefined)
              setConflict(undefined)
              if (isNew) onCancelNew()
              else setForm(baseForm)
            }}
          >
            Cancel
          </Button>
          {isNew ? null : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                del.setOpen(true)
              }}
            >
              Delete token
            </Button>
          )}
        </div>
      </form>
      {del.error === undefined ? null : (
        <Alert variant="danger" title="Could not delete">
          <p>{del.error}</p>
        </Alert>
      )}
      {isNew ? null : <DeleteDialog path={original.path} state={del} />}
    </section>
  )
}
