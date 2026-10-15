import { isValidName, parseAlias, splitPath } from '@dts/tokens-core'
import { LIMITS, RESERVED_NAMES } from '../limits'
import { bad, cleanInput, good, type Parsed } from './result'

/**
 * An alias is typed as `{path.to.token}` or as the bare path. Returns the target
 * path. Whether the target EXISTS and is allowed (tiers) is validateLocal's job.
 */
export function parseAliasText(text: string): Parsed<string> {
  const input = cleanInput(text)
  const message =
    'Enter the path of another token, like primitive.color.blue-500.'
  if (input === undefined || input === '') return bad(message)
  const braced =
    input.startsWith('{') || input.endsWith('}') ? input : `{${input}}`
  const parsed = parseAlias(braced)
  if (parsed.kind !== 'alias') return bad(message)
  const { target } = parsed
  if (target.length > LIMITS.maxPathLength) {
    return bad(`A path may be at most ${LIMITS.maxPathLength} characters.`)
  }
  const segments = splitPath(target)
  if (!segments.every(isValidName)) return bad(message)
  if (segments.some((segment) => RESERVED_NAMES.has(segment))) {
    return bad('That name is reserved and cannot be used in a path.')
  }
  return good(target)
}

export function formatAlias(target: string): string {
  return `{${target}}`
}
