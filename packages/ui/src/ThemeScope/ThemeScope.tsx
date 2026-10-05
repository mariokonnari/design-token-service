import type { ComponentPropsWithRef } from 'react'

/**
 * The slug rule: lowercase letters and digits in hyphen-separated groups.
 *
 * This is a COPY of the name rule in packages/tokens-core/src/names.ts
 * (`NAME_PATTERN`, via `isValidName`), which is the source of truth. It is
 * duplicated because packages/ui/src must not import tokens-core (ADR 0001,
 * enforced by lint). packages/ui/test/themeSlug.sync.test.ts fails if the two
 * ever disagree.
 */
const THEME_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidThemeSlug(value: string): boolean {
  return THEME_SLUG_PATTERN.test(value)
}

export type ThemeScopeProps = Omit<
  ComponentPropsWithRef<'div'>,
  'data-theme'
> & {
  /** A theme slug, as in `[data-theme="<slug>"]` in the generated CSS, e.g. `default` or `acme`. */
  theme: string
}

/**
 * Scopes a subtree to a theme by setting `data-theme`. The generated theme CSS
 * declares the variables on `[data-theme="<slug>"]`, so everything inside picks
 * up that theme's values. An invalid slug throws: a wrong theme is a
 * programmer error, and silently falling back would hide it.
 */
export function ThemeScope({ theme, ...props }: ThemeScopeProps) {
  if (!isValidThemeSlug(theme)) {
    throw new Error(
      `ThemeScope: "${theme}" is not a valid theme slug (lowercase letters, digits and single hyphens only)`,
    )
  }
  return <div {...props} data-theme={theme} />
}
