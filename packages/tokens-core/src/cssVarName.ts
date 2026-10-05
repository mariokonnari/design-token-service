/** Placeholder: maps a dotted token path to a CSS custom property name. */
export function cssVarName(tokenPath: string): string {
  return `--${tokenPath.replaceAll('.', '-')}`
}
