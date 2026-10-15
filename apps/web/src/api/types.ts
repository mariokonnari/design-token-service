/**
 * What the API answers, written BY HAND from apps/api/src/routes/* (ADR 0013,
 * 0014, 0016). There is deliberately no shared contracts package yet: the drift
 * risk (the server changes a field and these types do not) is real, and the only
 * thing that would notice is the real-stack e2e suite in e2e/ plus the fixtures of
 * the unit tests. Keep this file small and update it with the route.
 */

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER'
export type Visibility = 'PRIVATE' | 'PUBLIC'

export interface User {
  id: string
  email: string
  createdAt: string
}

/** An organization the caller belongs to, with the caller's role in it. */
export interface Organization {
  id: string
  slug: string
  name: string
  role: Role
}

export interface Brand {
  id: string
  slug: string
  name: string
  visibility: Visibility
  draftRevision: number
  createdAt: string
}

export interface Credentials {
  email: string
  password: string
}

/** The body of the create calls: `{ name, slug }` and nothing else (the API bodies are strict). */
export interface NameAndSlug {
  name: string
  slug: string
}

/** A draft token as GET /tokens sends it. `value` is raw JSON: an alias is "{a.b}" with `type: null`; a corrupt stored row comes back raw too. */
export interface ServerToken {
  path: string
  type: string | null
  value: unknown
  description: string | null
  version: number
  updatedAt: string
}

export interface TokenList {
  draftRevision: number
  tokens: ServerToken[]
}

/** An issue as the API sends it (fixed fields; `related` lists other paths). */
export interface ApiIssue {
  code: string
  severity: 'error' | 'warning'
  path: string
  field?: string
  message: string
  related?: string[]
}

/** The body of PUT /tokens/:path (`path` goes in the URL). `expectedVersion` is omitted when creating. */
export interface PutTokenInput {
  path: string
  type?: string
  value: unknown
  description?: string
  expectedVersion?: number
}

export interface PutTokenResult {
  token: ServerToken
  draftRevision: number
  warnings: ApiIssue[]
}

export interface DeleteTokenResult {
  draftRevision: number
}

export interface ValidationReport {
  draftRevision: number
  publishable: boolean
  issues: ApiIssue[]
}

export interface ImportInput {
  tree: unknown
  expectedRevision: number
}

export interface ImportResult {
  draftRevision: number
  count: number
  warnings: ApiIssue[]
}
