import * as csstree from 'css-tree'
import type { Token } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import {
  applyPreviewStyle,
  buildPreviewCss,
  PREVIEW_STYLE_ATTRIBUTE,
} from '../../src/editor/preview'
import { STARTER_TOKENS } from '../../src/editor/starter'

const color = (path: string, rgb: [number, number, number]): Token => ({
  path,
  type: 'color',
  value: { colorSpace: 'srgb', components: rgb },
})

const chain = (blue: [number, number, number]): Token[] => [
  color('primitive.color.blue', blue),
  { path: 'semantic.color.action', alias: 'primitive.color.blue' },
  { path: 'component.button.bg', alias: 'semantic.color.action' },
]

/** Parses the output and returns [selector, declarations] of its only rule; fails on anything else. */
function onlyRule(css: string) {
  const ast = csstree.parse(css)
  const children = ast.type === 'StyleSheet' ? ast.children.toArray() : []
  expect(children.map((c) => c.type)).toEqual(['Rule'])
  const rule = children[0]
  if (rule?.type !== 'Rule') throw new Error('no rule')
  const selector = csstree.generate(rule.prelude)
  const declarations = rule.block.children.toArray().map((child) => {
    expect(child.type).toBe('Declaration')
    return child.type === 'Declaration'
      ? { property: child.property, value: csstree.generate(child.value) }
      : { property: '', value: '' }
  })
  return { selector, declarations }
}

describe('buildPreviewCss', () => {
  it('scopes everything to [data-theme="preview"] and exports the semantic and component tiers only', () => {
    const { css, issues } = buildPreviewCss(chain([0, 0, 1]))
    expect(issues).toEqual([])
    const { selector, declarations } = onlyRule(css)
    expect(selector).toBe('[data-theme="preview"]')
    expect(declarations.map((d) => d.property)).toEqual([
      '--component-button-bg',
      '--semantic-color-action',
    ])
    expect(css).not.toContain('--primitive')
  })

  it('editing a primitive changes the semantic and the component output (alias propagation)', () => {
    const blue = buildPreviewCss(chain([0, 0, 1])).css
    const red = buildPreviewCss(chain([1, 0, 0])).css
    expect(blue).toContain('--semantic-color-action: #0000ff')
    expect(blue).toContain('--component-button-bg: #0000ff')
    expect(red).toContain('--semantic-color-action: #ff0000')
    expect(red).toContain('--component-button-bg: #ff0000')
  })

  it('a broken alias drops only its own variables and the ones that depend on it', () => {
    const tokens: Token[] = [
      ...chain([0, 0, 1]),
      { path: 'semantic.color.broken', alias: 'primitive.color.missing' },
      { path: 'component.button.border', alias: 'semantic.color.broken' },
      { path: 'semantic.color.fine', alias: 'primitive.color.blue' },
    ]
    const { css, issues } = buildPreviewCss(tokens)
    expect(css).toContain('--semantic-color-fine')
    expect(css).toContain('--component-button-bg')
    expect(css).not.toContain('--semantic-color-broken')
    expect(css).not.toContain('--component-button-border')
    expect(issues.length).toBeGreaterThan(0)
  })

  it('never throws on an empty draft and gives empty CSS', () => {
    expect(buildPreviewCss([])).toEqual({ css: '', issues: [] })
  })

  it.each([
    ['closes the declaration', 'Arial"; } body { display:none } /*'],
    ['closes the style element', '</style><script>alert(1)</script>'],
    ['an import', '@import url(//evil.example/x.css);'],
    ['backslashes', '\\'.repeat(500)],
  ])(
    'hostile font family (%s) stays one declaration in one rule',
    (_label, family) => {
      const tokens: Token[] = [
        {
          path: 'semantic.font.sans',
          type: 'fontFamily',
          value: ['Inter', family],
        },
        { path: 'semantic.n.one', type: 'number', value: 1 },
      ]
      const { css } = buildPreviewCss(tokens)
      if (css !== '') {
        const { selector, declarations } = onlyRule(css)
        expect(selector).toBe('[data-theme="preview"]')
        expect(declarations.every((d) => d.property.startsWith('--'))).toBe(
          true,
        )
      }
      expect(css.toLowerCase()).not.toContain('</style')
    },
  )

  it('the real starter template builds without issues and resolves every library variable', () => {
    const { css, issues } = buildPreviewCss(STARTER_TOKENS)
    expect(issues).toEqual([])
    const { declarations } = onlyRule(css)
    expect(declarations.length).toBeGreaterThan(150)
  })
})

describe('applyPreviewStyle', () => {
  it('keeps ONE <style data-dts-preview> in the head and writes textContent only', () => {
    const doc = document.implementation.createHTMLDocument('t')
    expect(applyPreviewStyle(doc, '[data-theme="preview"]{--a:1}')).toEqual({
      ok: true,
    })
    expect(applyPreviewStyle(doc, '[data-theme="preview"]{--a:2}')).toEqual({
      ok: true,
    })
    const styles = doc.head.querySelectorAll(
      `style[${PREVIEW_STYLE_ATTRIBUTE}]`,
    )
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).toBe('[data-theme="preview"]{--a:2}')
    expect(styles[0]?.children).toHaveLength(0)
  })

  it('refuses output containing "<": the style is emptied and the result says so', () => {
    const doc = document.implementation.createHTMLDocument('t')
    applyPreviewStyle(doc, '[data-theme="preview"]{--a:1}')
    expect(
      applyPreviewStyle(doc, '[data-theme="preview"]{--a:"</style>"}'),
    ).toEqual({ ok: false })
    const style = doc.head.querySelector(`style[${PREVIEW_STYLE_ATTRIBUTE}]`)
    expect(style?.textContent).toBe('')
    expect(doc.body.children).toHaveLength(0)
  })

  it('an empty string empties the style', () => {
    const doc = document.implementation.createHTMLDocument('t')
    applyPreviewStyle(doc, '[data-theme="preview"]{--a:1}')
    applyPreviewStyle(doc, '')
    expect(
      doc.head.querySelector(`style[${PREVIEW_STYLE_ATTRIBUTE}]`)?.textContent,
    ).toBe('')
  })
})

describe('timing: 2000 tokens (1000 primitive colors, 500 semantic and 500 component aliases)', () => {
  it('resolve + toCssVariables stays well under the generous bound', () => {
    const tokens: Token[] = []
    for (let i = 0; i < 1000; i += 1) {
      tokens.push(color(`primitive.color.c${i}`, [(i % 255) / 255, 0.5, 0.25]))
    }
    for (let i = 0; i < 500; i += 1) {
      tokens.push({
        path: `semantic.color.s${i}`,
        alias: `primitive.color.c${i}`,
      })
    }
    for (let i = 0; i < 500; i += 1) {
      tokens.push({
        path: `component.part.p${i}`,
        alias: `semantic.color.s${i}`,
      })
    }
    expect(tokens).toHaveLength(2000)
    const runs: number[] = []
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now()
      const { css } = buildPreviewCss(tokens)
      runs.push(performance.now() - start)
      expect(css.length).toBeGreaterThan(0)
    }
    runs.sort((a, b) => a - b)
    const median = runs[10] ?? 0
    const worst = runs[19] ?? 0
    console.log(
      `preview timing, 2000 tokens: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`,
    )
    expect(median).toBeLessThan(500)
  })
})
