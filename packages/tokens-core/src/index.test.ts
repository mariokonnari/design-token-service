import { describe, expect, it } from 'vitest'
import * as api from './index'

describe('public API', () => {
  it('exposes exactly the intended runtime exports', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'ISSUE_CODES',
        'TIERS',
        'TOKEN_TYPES',
        'checkTiers',
        'comparePaths',
        'contrastRatio',
        'cssVarName',
        'flattenAlpha',
        'flatten',
        'fontWeightToNumber',
        'isValidName',
        'joinPath',
        'nest',
        'parseAlias',
        'parseHex',
        'relativeLuminance',
        'resolve',
        'splitPath',
        'tierOf',
        'toCssVariables',
        'toHex',
        'toResolvedTree',
        'validateLiteral',
      ].sort(),
    )
  })

  it('lists every issue code', () => {
    expect([...api.ISSUE_CODES].sort()).toEqual(
      [
        'INVALID_NAME',
        'INVALID_TYPE',
        'MISSING_TYPE',
        'UNSUPPORTED_TYPE',
        'UNSUPPORTED_COLOR_SPACE',
        'UNSUPPORTED_FEATURE',
        'INVALID_STRUCTURE',
        'INVALID_VALUE',
        'HEX_MISMATCH',
        'PATH_CONFLICT',
        'CSS_NAME_COLLISION',
        'ALIAS_NOT_FOUND',
        'ALIAS_TARGET_INVALID',
        'ALIAS_CYCLE',
        'TYPE_MISMATCH',
        'TIER_VIOLATION',
      ].sort(),
    )
  })

  it('keeps cssVarName working', () => {
    expect(api.cssVarName('color.blue.500')).toBe('--color-blue-500')
  })

  it('runs the whole pipeline end to end, including both exporters', () => {
    const flat = api.flatten({
      primitive: {
        color: {
          blue: {
            $type: 'color',
            $value: { colorSpace: 'srgb', components: [0, 0, 1] },
          },
        },
      },
      semantic: { action: { $value: '{primitive.color.blue}' } },
      component: { button: { bg: { $value: '{semantic.action}' } } },
    })
    expect(flat.issues).toEqual([])

    const resolved = api.resolve(flat.tokens, { rejected: flat.rejected })
    expect(resolved.issues).toEqual([])
    expect(resolved.resolved.map((token) => token.path)).toEqual([
      'component.button.bg',
      'primitive.color.blue',
      'semantic.action',
    ])
    expect(api.checkTiers(flat.tokens)).toEqual([])

    const css = api.toCssVariables(resolved.resolved, {
      include: ['semantic', 'component'],
    })
    expect(css.issues).toEqual([])
    expect(css.css).toBe(
      ':root {\n  --component-button-bg: #0000ff;\n  --semantic-action: #0000ff;\n}\n',
    )

    const json = api.toResolvedTree(resolved.resolved)
    expect(json.issues).toEqual([])
    expect(Object.keys(json.tree)).toEqual([
      'component',
      'primitive',
      'semantic',
    ])
  })
})
