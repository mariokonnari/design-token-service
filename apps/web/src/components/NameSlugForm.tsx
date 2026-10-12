import { Button, TextField } from '@dts/ui'
import { useState } from 'react'
import type { NameAndSlug } from '../api/types'
import type { FormContext } from '../forms/describeError'
import { MAX_SLUG_LENGTH, suggestSlug } from '../forms/slug'
import { useSubmitForm } from '../forms/useSubmitForm'
import { validateNameAndSlug } from '../forms/validation'
import { FormErrorSummary } from './FormErrorSummary'

/**
 * The "create <thing>" form of an organization and of a brand: a name and a slug.
 * The slug is suggested from the name ("Café Münch" -> "cafe-munch") until the
 * person edits the slug themselves; clearing the slug hands it back to the name.
 * Client checks use the same rules as the API (tokens-core's slug rule plus the
 * 63-character cap); the API's answer is mapped back to the fields (a taken slug
 * is a slug error).
 */
export function NameSlugForm<T>({
  idPrefix,
  context,
  heading,
  submitLabel,
  pendingLabel,
  create,
  onCreated,
}: {
  idPrefix: string
  context: Extract<FormContext, 'createOrg' | 'createBrand'>
  heading: string
  submitLabel: string
  pendingLabel: string
  create: (input: NameAndSlug) => Promise<T>
  onCreated: (created: T) => void
}) {
  const [slugEdited, setSlugEdited] = useState(false)
  const form = useSubmitForm({
    context,
    initial: { name: '', slug: '' },
    order: ['name', 'slug'],
    fieldIds: { name: `${idPrefix}-name`, slug: `${idPrefix}-slug` },
    validate: validateNameAndSlug,
    submit: (values) => create({ name: values.name.trim(), slug: values.slug }),
    onSuccess: (created) => {
      form.reset()
      setSlugEdited(false)
      onCreated(created)
    },
  })

  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="create">
      <h2 id={`${idPrefix}-heading`}>{heading}</h2>
      <form
        noValidate
        className="form"
        onSubmit={(event) => {
          void form.handleSubmit(event)
        }}
      >
        {form.hasProblems ? (
          <FormErrorSummary
            attach={form.attachSummary}
            items={form.summaryItems}
            message={form.formMessage}
            requestId={form.requestId}
          />
        ) : null}
        <TextField
          id={`${idPrefix}-name`}
          name="name"
          label="Name"
          autoComplete="off"
          required
          value={form.values.name}
          error={form.errors.name}
          onChange={(event) => {
            const name = event.target.value
            form.setValue('name', name)
            if (!slugEdited) form.setValue('slug', suggestSlug(name))
          }}
        />
        <TextField
          id={`${idPrefix}-slug`}
          name="slug"
          label="Slug"
          description={`Used in addresses. Lowercase letters and digits, separated by single hyphens, at most ${MAX_SLUG_LENGTH} characters. It cannot be changed later.`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={form.values.slug}
          error={form.errors.slug}
          onChange={(event) => {
            const slug = event.target.value
            form.setValue('slug', slug)
            setSlugEdited(slug !== '')
          }}
        />
        <Button type="submit" disabled={form.pending}>
          {form.pending ? pendingLabel : submitLabel}
        </Button>
      </form>
    </section>
  )
}
