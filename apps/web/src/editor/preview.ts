import {
  resolve,
  toCssVariables,
  type Issue,
  type Token,
} from '@dts/tokens-core'

/**
 * The live preview (ADR 0017). The working copy is resolved and exported with the
 * SAME exporter that publishes (semantic and component tiers, scoped to
 * `[data-theme="preview"]`), so what the preview shows is what a release would
 * contain. A token that fails to resolve is omitted, so the cascade falls back to
 * the surrounding default theme instead of leaving a hole.
 */

export const PREVIEW_THEME = 'preview'
export const PREVIEW_STYLE_ATTRIBUTE = 'data-dts-preview'

export function buildPreviewCss(tokens: readonly Token[]): {
  css: string
  issues: Issue[]
} {
  const resolved = resolve(tokens)
  const exported = toCssVariables(resolved.resolved, {
    scope: { kind: 'attribute', name: 'data-theme', value: PREVIEW_THEME },
    include: ['semantic', 'component'],
  })
  return { css: exported.css, issues: [...resolved.issues, ...exported.issues] }
}

/**
 * Keeps ONE `<style data-dts-preview>` in the document head and writes `textContent`
 * only (never markup). Output containing `<` is refused: the style is emptied and
 * the result says so. The exporter already escapes `<`, so this is a second wall.
 */
export function applyPreviewStyle(doc: Document, css: string): { ok: boolean } {
  let style = doc.head.querySelector(`style[${PREVIEW_STYLE_ATTRIBUTE}]`)
  if (style === null) {
    style = doc.createElement('style')
    style.setAttribute(PREVIEW_STYLE_ATTRIBUTE, '')
    doc.head.append(style)
  }
  if (css.includes('<')) {
    style.textContent = ''
    return { ok: false }
  }
  style.textContent = css
  return { ok: true }
}
