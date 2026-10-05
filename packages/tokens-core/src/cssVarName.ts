/**
 * Maps a dotted token path to a CSS custom property name: `a.b-c` -> `--a-b-c`.
 * A plain string mapping with no validation: callers must pass a path whose
 * segments are valid names (`toCssVariables` checks that, and also detects the
 * collisions this mapping allows, such as `a.b-c` and `a-b.c`).
 */
export function cssVarName(tokenPath: string): string {
  return `--${tokenPath.replaceAll('.', '-')}`
}
