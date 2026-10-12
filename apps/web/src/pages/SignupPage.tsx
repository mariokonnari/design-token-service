import { Button, TextField } from '@dts/ui'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useApi } from '../ApiContext'
import { ME_KEY } from '../auth/me'
import { isSafeNext, safeNext } from '../auth/safeNext'
import { FormErrorSummary } from '../components/FormErrorSummary'
import { PageHeading } from '../components/PageHeading'
import { useSubmitForm } from '../forms/useSubmitForm'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validateSignup,
} from '../forms/validation'

export function SignupPage() {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const rawNext = params.get('next')
  const loginPath = isSafeNext(rawNext)
    ? `/login?next=${encodeURIComponent(rawNext)}`
    : '/login'

  const form = useSubmitForm({
    context: 'signup',
    initial: { email: '', password: '' },
    order: ['email', 'password'],
    fieldIds: { email: 'signup-email', password: 'signup-password' },
    validate: validateSignup,
    submit: (values) =>
      api.signup({ email: values.email.trim(), password: values.password }),
    onSuccess: (user) => {
      void navigate(safeNext(rawNext), { replace: true })
      queryClient.setQueryData(ME_KEY, user)
    },
    clearOnError: ['password'],
  })

  return (
    <div className="page page--narrow">
      <PageHeading title="Create an account" />
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
          id="signup-email"
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
          id="signup-password"
          name="password"
          type="password"
          label="Password"
          description={`At least ${MIN_PASSWORD_LENGTH} characters, at most ${MAX_PASSWORD_LENGTH}. Any characters are allowed.`}
          autoComplete="new-password"
          required
          value={form.values.password}
          error={form.errors.password}
          onChange={(event) => {
            form.setValue('password', event.target.value)
          }}
        />
        <Button type="submit" disabled={form.pending}>
          {form.pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p>
        Already have an account?{' '}
        <Link className="link" to={loginPath}>
          Sign in
        </Link>
      </p>
    </div>
  )
}
