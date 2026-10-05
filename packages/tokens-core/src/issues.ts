import { comparePaths } from './names'
import type { Issue, IssueCode } from './types'

interface IssueExtras {
  field?: string
  related?: readonly string[]
}

function make(
  severity: Issue['severity'],
  code: IssueCode,
  path: string,
  message: string,
  extras: IssueExtras,
): Issue {
  const issue: Issue = { code, severity, path, message }
  if (extras.field !== undefined) issue.field = extras.field
  if (extras.related !== undefined) issue.related = extras.related
  return issue
}

export function error(
  code: IssueCode,
  path: string,
  message: string,
  extras: IssueExtras = {},
): Issue {
  return make('error', code, path, message, extras)
}

export function warning(
  code: IssueCode,
  path: string,
  message: string,
  extras: IssueExtras = {},
): Issue {
  return make('warning', code, path, message, extras)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Deterministic order: path, then code, then field, then message. */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      comparePaths(a.path, b.path) ||
      compareText(a.code, b.code) ||
      compareText(a.field ?? '', b.field ?? '') ||
      compareText(a.message, b.message),
  )
}

export function hasError(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}
