import { Button, TextField } from '@dts/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useApi } from '../ApiContext'
import { ME_KEY } from '../auth/me'
import { isSafeNext, safeNext } from '../auth/safeNext'
import { FormErrorSummary } from '../components/FormErrorSummary'
import { PageHeading } from '../components/PageHeading'
import { useSubmitForm } from '../forms/useSubmitForm'
import { validateLogin } from '../forms/validation'

export function LoginPage() {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const rawNext = params.get('next')
  const signupPath = isSafeNext(rawNext)
    ? `/signup?next=${encodeURIComponent(rawNext)}`
    : '/signup'

  const form = useSubmitForm({
    context: 'login',
    initial: { email: '', password: '' },
    order: ['email', 'password'],
    fieldIds: { email: 'login-email', password: 'login-password' },
    validate: validateLogin,
    submit: (values) =>
      api.login({ email: values.email.trim(), password: values.password }),
    onSuccess: (user) => {
      // Back to the page they wanted, but only if it is a safe same-origin path.
      void navigate(safeNext(rawNext), { replace: true })
      queryClient.setQueryData(ME_KEY, user)
    },
    clearOnError: ['password'],
  })

  return (
    <div className="page page--narrow">
      <PageHeading title="Sign in" />
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
          id="login-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          required
          value={form.values.email}
          error={form.errors.email}
          onChange={(event) => {
            form.setValue('email', event.target.value)
          }}
        />
        <TextField
          id="login-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
          value={form.values.password}
          error={form.errors.password}
          onChange={(event) => {
            form.setValue('password', event.target.value)
          }}
        />
        <Button type="submit" disabled={form.pending}>
          {form.pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p>
        No account yet?{' '}
        <Link className="link" to={signupPath}>
          Create an account
        </Link>
      </p>
    </div>
  )
}
