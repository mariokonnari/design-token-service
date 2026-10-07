import { MIN_BY_KIND, type ContrastPair } from './support/contrast'

/**
 * The contrast registry: every text/background (and non-text/background) pair
 * the components rely on, declared as data and checked for EVERY theme by
 * test/contrast.test.ts.
 *
 * Rules for entries:
 * - `background` is the color the foreground really renders on. Label,
 *   description and error text of a field sit on the page SURFACE, not on the
 *   input background; only the input's own text and placeholder go against the
 *   input background. A border is registered against the surface outside the
 *   control and, where it is a different token, against the control background.
 * - Disabled states are exempt from WCAG contrast and are not listed.
 * - NOTHING enforces that a new pair gets added here. Adding a component's
 *   pairs is a manual step (see the checklist in CLAUDE.md); the tests only
 *   check the entries that exist (and that every component folder has some).
 */

const SURFACE = 'semantic.color.surface'

const text = (
  component: string,
  id: string,
  foreground: string,
  background: string,
): ContrastPair => ({
  component,
  id,
  kind: 'text',
  foreground,
  background,
  min: MIN_BY_KIND.text,
})

const nonText = (
  component: string,
  id: string,
  foreground: string,
  background: string,
): ContrastPair => ({
  component,
  id,
  kind: 'non-text',
  foreground,
  background,
  min: MIN_BY_KIND['non-text'],
})

const ROLES = ['info', 'success', 'warning', 'danger'] as const

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Shared semantic roles.
  text('Semantic', 'text on surface', 'semantic.color.text', SURFACE),
  text(
    'Semantic',
    'text-muted on surface',
    'semantic.color.text-muted',
    SURFACE,
  ),
  text(
    'Semantic',
    'placeholder on surface',
    'semantic.color.placeholder',
    SURFACE,
  ),
  text(
    'Semantic',
    'danger text on surface',
    'semantic.color.danger.text',
    SURFACE,
  ),
  text(
    'Semantic',
    'on-primary on action-primary',
    'semantic.color.action.on-primary',
    'semantic.color.action.primary',
  ),
  text(
    'Semantic',
    'on-primary on action-primary-hover',
    'semantic.color.action.on-primary',
    'semantic.color.action.primary-hover',
  ),
  nonText(
    'Semantic',
    'focus-ring on surface',
    'semantic.color.focus-ring',
    SURFACE,
  ),
  nonText('Semantic', 'border on surface', 'semantic.color.border', SURFACE),
  nonText(
    'Semantic',
    'input-border on surface',
    'semantic.color.input-border',
    SURFACE,
  ),

  // Button.
  text(
    'Button',
    'text-primary on bg-primary',
    'component.button.text-primary',
    'component.button.bg-primary',
  ),
  text(
    'Button',
    'text-primary on bg-primary-hover',
    'component.button.text-primary',
    'component.button.bg-primary-hover',
  ),
  text(
    'Button',
    'text-secondary on bg-secondary',
    'component.button.text-secondary',
    'component.button.bg-secondary',
  ),
  text(
    'Button',
    'text-secondary on bg-secondary-hover',
    'component.button.text-secondary',
    'component.button.bg-secondary-hover',
  ),
  nonText(
    'Button',
    'border-secondary on the surface',
    'component.button.border-secondary',
    SURFACE,
  ),
  nonText(
    'Button',
    'focus-ring on surface',
    'semantic.color.focus-ring',
    SURFACE,
  ),

  // TextField: its own text and placeholder sit on the input background; the
  // label, description, required hint and error sit on the page surface.
  text(
    'TextField',
    'input text on input background',
    'component.textfield.text',
    'component.textfield.bg',
  ),
  text(
    'TextField',
    'placeholder on input background',
    'component.textfield.placeholder',
    'component.textfield.bg',
  ),
  text(
    'TextField',
    'label on surface',
    'component.textfield.label-text',
    SURFACE,
  ),
  text(
    'TextField',
    'description on surface',
    'component.textfield.description-text',
    SURFACE,
  ),
  text(
    'TextField',
    'required hint on surface',
    'component.textfield.required-text',
    SURFACE,
  ),
  text(
    'TextField',
    'error text on surface',
    'component.textfield.error-text',
    SURFACE,
  ),
  nonText(
    'TextField',
    'border on surface',
    'component.textfield.border',
    SURFACE,
  ),
  nonText(
    'TextField',
    'border on input background',
    'component.textfield.border',
    'component.textfield.bg',
  ),
  nonText(
    'TextField',
    'invalid border on surface',
    'component.textfield.border-invalid',
    SURFACE,
  ),
  nonText(
    'TextField',
    'invalid border on input background',
    'component.textfield.border-invalid',
    'component.textfield.bg',
  ),
  nonText(
    'TextField',
    'focus-ring on surface',
    'semantic.color.focus-ring',
    SURFACE,
  ),

  // Checkbox: the label and description sit on the page surface.
  text(
    'Checkbox',
    'label on surface',
    'component.checkbox.label-text',
    SURFACE,
  ),
  text(
    'Checkbox',
    'description on surface',
    'component.checkbox.description-text',
    SURFACE,
  ),
  nonText(
    'Checkbox',
    'accent on surface',
    'component.checkbox.accent',
    SURFACE,
  ),
  nonText(
    'Checkbox',
    'focus-ring on surface',
    'semantic.color.focus-ring',
    SURFACE,
  ),

  // Tabs: the tab labels sit on the page surface. The selected indicator is a
  // non-text part. Selection is also shown by font weight, never color alone.
  text('Tabs', 'tab text on surface', 'component.tabs.text', SURFACE),
  text(
    'Tabs',
    'selected tab text on surface',
    'component.tabs.text-selected',
    SURFACE,
  ),
  nonText(
    'Tabs',
    'selected indicator on surface',
    'component.tabs.indicator',
    SURFACE,
  ),
  nonText(
    'Tabs',
    'focus-ring on surface',
    'semantic.color.focus-ring',
    SURFACE,
  ),

  // Dialog: its text sits on the dialog surface; its border is the edge
  // against the page surface. The backdrop overlay is translucent and is not
  // registered (the registry needs opaque colors; test/overlay.test.ts checks it).
  text(
    'Dialog',
    'text on dialog surface',
    'component.dialog.text',
    'component.dialog.bg',
  ),
  text(
    'Dialog',
    'description on dialog surface',
    'component.dialog.description-text',
    'component.dialog.bg',
  ),
  nonText(
    'Dialog',
    'border on page surface',
    'component.dialog.border',
    SURFACE,
  ),
  nonText(
    'Dialog',
    'close icon on dialog surface',
    'component.dialog.close-icon',
    'component.dialog.bg',
  ),
  nonText(
    'Dialog',
    'focus-ring on dialog surface',
    'semantic.color.focus-ring',
    'component.dialog.bg',
  ),

  // Alert: text on its own background; the border and icon on that background
  // and, because the border is also the alert's edge, on the page surface.
  ...ROLES.flatMap((role) => [
    text(
      'Alert',
      `${role} text on ${role} background`,
      `component.alert.${role}-text`,
      `component.alert.${role}-bg`,
    ),
    nonText(
      'Alert',
      `${role} border/icon on ${role} background`,
      `component.alert.${role}-border`,
      `component.alert.${role}-bg`,
    ),
    nonText(
      'Alert',
      `${role} border/icon on surface`,
      `component.alert.${role}-border`,
      SURFACE,
    ),
  ]),
]
