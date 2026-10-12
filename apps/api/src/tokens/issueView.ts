import type { Issue } from '@dts/tokens-core'
import type { DraftIssue } from './mapper'

/** At most this many issues are sent back; a broken draft or import can have thousands. */
export const MAX_ISSUES_IN_RESPONSE = 50

/** The client-facing shape of an issue (a fixed set of fields, never the raw object). */
export function issueView(issue: Issue | DraftIssue) {
  return {
    code: issue.code,
    severity: issue.severity,
    path: issue.path,
    ...(issue.field === undefined ? {} : { field: issue.field }),
    message: issue.message,
    ...(issue.related === undefined ? {} : { related: issue.related }),
  }
}

/** `details` for an error that lists issues: the first 50 and the total. */
export function issueDetails(issues: readonly (Issue | DraftIssue)[]) {
  return {
    issues: issues.slice(0, MAX_ISSUES_IN_RESPONSE).map(issueView),
    issueCount: issues.length,
  }
}
