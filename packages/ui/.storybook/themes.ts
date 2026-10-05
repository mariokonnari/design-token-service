/**
 * The themes offered by the toolbar toggle. Must match the `<slug>.tokens.json`
 * files in packages/ui/tokens (test/storybook.test.ts checks that), because the
 * generated CSS only defines variables for those slugs.
 */
export const THEMES = ['default', 'acme'] as const

export type Theme = (typeof THEMES)[number]
