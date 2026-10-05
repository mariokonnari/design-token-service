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
        'cssVarName',
        'flatten',
        'isValidName',
        'joinPath',
        'nest',
        'parseAlias',
        'resolve',
        'splitPath',
        'tierOf',
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
        'ALIAS_NOT_FOUND',
        'ALIAS_TARGET_INVALID',
        'ALIAS_CYCLE',
        'TYPE_MISMATCH',
        'TIER_VIOLATION',
      ].sort(),
    )
  })

  it('runs the whole pipeline end to end', () => {
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
  })
})
