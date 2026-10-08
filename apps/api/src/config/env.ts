import { z } from 'zod'

/**
 * The API's configuration, validated once at startup. Fails closed:
 * - NODE_ENV has no default (a missing value must not silently mean "development");
 * - SESSION_SECRET has no default anywhere;
 * - one error lists EVERY invalid variable, and never prints a value (secrets).
 */

export const MIN_SESSION_SECRET_LENGTH = 32

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      url.hostname !== '' &&
      url.pathname.length > 1
    )
  } catch {
    return false
  }
}

/** An origin is scheme + host [+ port]: no path, no trailing slash. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    )
  } catch {
    return false
  }
}

const schema = z.object({
  DATABASE_URL: z
    .string({ error: 'is required' })
    .refine(
      isPostgresUrl,
      'must be a postgres:// or postgresql:// URL with a host and a database name',
    ),
  PORT: z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    error: 'is required and must be one of development, test, production',
  }),
  SESSION_SECRET: z
    .string({ error: 'is required' })
    .min(
      MIN_SESSION_SECRET_LENGTH,
      `must be at least ${MIN_SESSION_SECRET_LENGTH} characters`,
    ),
  SIGNUP_ENABLED: z
    .enum(['true', 'false'], { error: 'must be exactly "true" or "false"' })
    .transform((value) => value === 'true')
    .default(true),
  ALLOWED_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    )
    .pipe(
      z.array(
        z
          .string()
          .refine(
            isOrigin,
            'every entry must be an origin like https://app.example.com (no path, no trailing slash)',
          ),
      ),
    )
    .default([]),
})

export type Env = z.output<typeof schema>

/** Variables that may be left blank in an env file, meaning "use the default". */
const BLANK_MEANS_UNSET = ['PORT', 'SIGNUP_ENABLED', 'ALLOWED_ORIGINS']

export interface EnvIssue {
  variable: string
  message: string
}

export class EnvError extends Error {
  readonly issues: readonly EnvIssue[]

  constructor(issues: readonly EnvIssue[]) {
    super(
      `Invalid environment variables:\n${issues
        .map((issue) => `  - ${issue.variable}: ${issue.message}`)
        .join('\n')}`,
    )
    this.name = 'EnvError'
    this.issues = issues
  }
}

/** Validates a plain object of strings (normally process.env). Pure: no I/O. */
export function parseEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env {
  const input: Record<string, string | undefined> = {}
  for (const key of Object.keys(schema.shape)) {
    const value = source[key]
    input[key] =
      value === '' && BLANK_MEANS_UNSET.includes(key) ? undefined : value
  }

  const result = schema.safeParse(input)
  if (result.success) return result.data

  // Group messages by variable so every invalid variable appears once.
  const byVariable = new Map<string, string[]>()
  for (const issue of result.error.issues) {
    const variable = String(issue.path[0] ?? '(unknown)')
    byVariable.set(variable, [
      ...(byVariable.get(variable) ?? []),
      issue.message,
    ])
  }
  throw new EnvError(
    [...byVariable].map(([variable, messages]) => ({
      variable,
      message: messages.join('; '),
    })),
  )
}
