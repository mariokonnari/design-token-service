import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  SIGNED_IN,
  apiError,
  deferred,
  org,
  renderApp,
} from '../support/renderApp'

const acme = org()
const globex = org({
  id: '44444444-4444-4444-8444-444444444444',
  slug: 'globex',
  name: 'Globex',
  role: 'VIEWER',
})

const listWith = (...organizations: ReturnType<typeof org>[]) => ({
  ...SIGNED_IN,
  'GET /api/orgs': { body: { organizations } },
})

describe('organization list', () => {
  it('shows each organization as a link with its slug and role', async () => {
    renderApp({ handlers: listWith(acme, globex) })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Organizations' }),
    ).toBeVisible()
    const link = await screen.findByRole('link', { name: 'Acme' })
    expect(link).toHaveAttribute('href', `/orgs/${acme.id}`)
    const item = link.closest('li')!
    expect(within(item).getByText('acme')).toBeVisible()
    expect(within(item).getByText('Owner')).toBeVisible()
    expect(
      within(
        screen.getByRole('link', { name: 'Globex' }).closest('li')!,
      ).getByText('Viewer'),
    ).toBeVisible()
  })

  it('says so when there are none', async () => {
    renderApp({ handlers: listWith() })
    expect(
      await screen.findByText(/not a member of any organization yet/i),
    ).toBeVisible()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows a loading status first', async () => {
    const gate = deferred()
    renderApp({
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': { body: { organizations: [] }, hold: gate.promise },
      },
    })
    expect(await screen.findByText(/loading organizations/i)).toBeVisible()
    gate.release()
    await screen.findByText(/not a member of any organization yet/i)
  })

  it('shows an error with a retry that works', async () => {
    const app = renderApp({
      handlers: {
        ...SIGNED_IN,
        'GET /api/orgs': apiError(500, 'INTERNAL_ERROR', '<b>boom</b>'),
      },
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong/i)
    expect(alert).not.toHaveTextContent('boom')
    app.setHandler('GET /api/orgs', { body: { organizations: [acme] } })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'Acme' })).toBeVisible()
  })

  it('renders names as text, never as markup', async () => {
    const hostile = org({ name: '<img src=x onerror="window.pwned=1"> Evil' })
    const app = renderApp({ handlers: listWith(hostile) })
    expect(await screen.findByRole('link', { name: /Evil/ })).toHaveTextContent(
      '<img src=x onerror="window.pwned=1"> Evil',
    )
    expect(app.container.querySelector('img')).toBeNull()
  })
})

describe('create organization', () => {
  async function openForm() {
    await screen.findByRole('heading', { level: 1, name: 'Organizations' })
    // the form appears once the list has loaded
    await screen.findByLabelText(/^name/i)
    return userEvent.setup()
  }

  it('suggests a slug from the name until the person edits the slug', async () => {
    renderApp({ handlers: listWith() })
    const typist = await openForm()
    const name = screen.getByLabelText(/^name/i)
    const slug = screen.getByLabelText(/^slug/i)

    await typist.type(name, 'Café Münch')
    expect(slug).toHaveValue('cafe-munch')
    await typist.clear(name)
    await typist.type(name, 'Acme Labs')
    expect(slug).toHaveValue('acme-labs')

    await typist.clear(slug)
    await typist.type(slug, 'mine')
    await typist.type(name, ' Two')
    expect(slug).toHaveValue('mine')
  })

  it('checks name and slug before sending, with the 63-character limit', async () => {
    const app = renderApp({ handlers: listWith() })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^slug/i), 'x'.repeat(64))
    await typist.click(
      screen.getByRole('button', { name: 'Create organization' }),
    )
    expect(app.calls('POST', '/api/orgs')).toHaveLength(0)
    const summary = screen.getByRole('alert')
    expect(summary).toHaveFocus()
    expect(summary).toHaveTextContent('Enter a name.')
    expect(summary).toHaveTextContent('at most 63 characters')
    expect(screen.getByLabelText(/^slug/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText(/^name/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('creates the organization: exact body, shows it in the list, clears the form, confirms', async () => {
    const app = renderApp({
      handlers: {
        ...listWith(),
        'POST /api/orgs': { status: 201, body: { organization: acme } },
      },
    })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^name/i), 'Acme')
    await typist.click(
      screen.getByRole('button', { name: 'Create organization' }),
    )

    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      `/orgs/${acme.id}`,
    )
    expect(app.calls('POST', '/api/orgs')[0]?.body).toEqual({
      name: 'Acme',
      slug: 'acme',
    })
    expect(screen.getByText(/created organization.*acme/i)).toBeVisible()
    expect(screen.getByLabelText(/^name/i)).toHaveValue('')
    expect(screen.getByLabelText(/^slug/i)).toHaveValue('')
    expect(app.unexpected).toEqual([])
  })

  it('a taken slug is an error on the slug field, the form keeps its values and the summary takes focus', async () => {
    renderApp({
      handlers: {
        ...listWith(),
        'POST /api/orgs': apiError(
          409,
          'SLUG_TAKEN',
          'An organization with this slug already exists.',
        ),
      },
    })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^name/i), 'Acme')
    await typist.click(
      screen.getByRole('button', { name: 'Create organization' }),
    )
    const slug = screen.getByLabelText(/^slug/i)
    await waitFor(() => {
      expect(slug).toHaveAttribute('aria-invalid', 'true')
    })
    expect(slug).toHaveAccessibleDescription(/already in use/i)
    expect(slug).toHaveValue('acme')
    expect(screen.getByLabelText(/^name/i)).toHaveValue('Acme')
    expect(screen.getByRole('alert')).toHaveFocus()
  })

  it('maps a 400 that names a field onto that field', async () => {
    renderApp({
      handlers: {
        ...listWith(),
        'POST /api/orgs': apiError(
          400,
          'VALIDATION_ERROR',
          'The name must be 1 to 200 characters.',
          {
            field: 'name',
          },
        ),
      },
    })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^name/i), 'Acme')
    await typist.click(
      screen.getByRole('button', { name: 'Create organization' }),
    )
    const name = screen.getByLabelText(/^name/i)
    await waitFor(() => {
      expect(name).toHaveAttribute('aria-invalid', 'true')
    })
    expect(name).toHaveAccessibleDescription(/1 to 200 characters/i)
  })

  it('editing a field clears the server error on it', async () => {
    renderApp({
      handlers: {
        ...listWith(),
        'POST /api/orgs': apiError(409, 'SLUG_TAKEN'),
      },
    })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^name/i), 'Acme')
    await typist.click(
      screen.getByRole('button', { name: 'Create organization' }),
    )
    await waitFor(() => {
      expect(screen.getByLabelText(/^slug/i)).toHaveAttribute(
        'aria-invalid',
        'true',
      )
    })
    await typist.type(screen.getByLabelText(/^slug/i), '2')
    expect(screen.getByLabelText(/^slug/i)).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('a pending create shows a busy button and cannot be sent twice', async () => {
    const gate = deferred()
    const app = renderApp({
      handlers: {
        ...listWith(),
        'POST /api/orgs': {
          status: 201,
          body: { organization: acme },
          hold: gate.promise,
        },
      },
    })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^name/i), 'Acme')
    await typist.keyboard('{Enter}')
    const busy = await screen.findByRole('button', { name: 'Creating…' })
    expect(busy).toBeDisabled()
    await typist.keyboard('{Enter}')
    gate.release()
    await screen.findByRole('link', { name: 'Acme' })
    expect(app.calls('POST', '/api/orgs')).toHaveLength(1)
  })

  it.each([
    [apiError(429, 'RATE_LIMITED'), /too many/i],
    [apiError(503, 'SERVICE_BUSY'), /busy/i],
    [{ networkError: true }, /cannot reach/i],
    [apiError(500, 'INTERNAL_ERROR'), /something went wrong/i],
  ])('shows %# in the summary', async (reply, text) => {
    renderApp({ handlers: { ...listWith(), 'POST /api/orgs': reply } })
    const typist = await openForm()
    await typist.type(screen.getByLabelText(/^name/i), 'Acme')
    await typist.click(
      screen.getByRole('button', { name: 'Create organization' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})
