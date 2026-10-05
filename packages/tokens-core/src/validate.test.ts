import { describe, expect, it } from 'vitest'
import { validateLiteral } from './validate'

const FONT_WEIGHT_NAMES = [
  'thin',
  'hairline',
  'extra-light',
  'ultra-light',
  'light',
  'normal',
  'regular',
  'book',
  'medium',
  'semi-bold',
  'demi-bold',
  'bold',
  'extra-bold',
  'ultra-bold',
  'black',
  'heavy',
  'extra-black',
  'ultra-black',
]

/** A failing result's single issue, asserting there is exactly one. */
function singleIssue(result: ReturnType<typeof validateLiteral>) {
  expect(result.ok).toBe(false)
  expect(result.issues).toHaveLength(1)
  const issue = result.issues[0]
  if (issue === undefined) throw new Error('expected an issue')
  return issue
}

describe('validateLiteral: color', () => {
  it('accepts a minimal srgb color and copies it', () => {
    const raw = { colorSpace: 'srgb', components: [0, 0.5, 1] }
    const result = validateLiteral('color', raw, 'p')
    expect(result).toEqual({
      ok: true,
      value: { colorSpace: 'srgb', components: [0, 0.5, 1] },
      issues: [],
    })
    if (result.ok && typeof result.value === 'object') {
      expect(result.value).not.toBe(raw)
    }
  })

  it('accepts alpha and a matching hex', () => {
    const result = validateLiteral(
      'color',
      { colorSpace: 'srgb', components: [1, 0, 1], alpha: 0.5, hex: '#FF00ff' },
      'p',
    )
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it.each([['#fff'], [null], [[1, 0, 0]], [42], [undefined]])(
    'rejects a non-object value %j with INVALID_VALUE on $value',
    (raw) => {
      const issue = singleIssue(validateLiteral('color', raw, 'p'))
      expect(issue).toMatchObject({
        code: 'INVALID_VALUE',
        severity: 'error',
        path: 'p',
        field: '$value',
      })
    },
  )

  it('rejects a missing colorSpace', () => {
    const issue = singleIssue(
      validateLiteral('color', { components: [0, 0, 0] }, 'p'),
    )
    expect(issue).toMatchObject({
      code: 'INVALID_VALUE',
      field: '$value.colorSpace',
    })
  })

  it.each(['display-p3', 'hsl', 'oklch', 'srgb-linear', 'xyz-d65'])(
    'reports spec color space %j as UNSUPPORTED_COLOR_SPACE',
    (colorSpace) => {
      const issue = singleIssue(
        validateLiteral('color', { colorSpace, components: [0, 0, 0] }, 'p'),
      )
      expect(issue).toMatchObject({
        code: 'UNSUPPORTED_COLOR_SPACE',
        severity: 'error',
        field: '$value.colorSpace',
      })
    },
  )

  it('reports an unknown color space as INVALID_VALUE', () => {
    const issue = singleIssue(
      validateLiteral(
        'color',
        { colorSpace: 'rgb', components: [0, 0, 0] },
        'p',
      ),
    )
    expect(issue).toMatchObject({
      code: 'INVALID_VALUE',
      field: '$value.colorSpace',
    })
  })

  it.each([[[0, 0]], [[0, 0, 0, 0]], ['0,0,0'], [undefined]])(
    'rejects components %j that are not three numbers',
    (components) => {
      const issue = singleIssue(
        validateLiteral('color', { colorSpace: 'srgb', components }, 'p'),
      )
      expect(issue).toMatchObject({
        code: 'INVALID_VALUE',
        field: '$value.components',
      })
    },
  )

  it.each([[1.5], [-0.1], [Number.NaN], [Infinity], ['0.5'], [null]])(
    'rejects component value %j with the index in field',
    (bad) => {
      const issue = singleIssue(
        validateLiteral(
          'color',
          { colorSpace: 'srgb', components: [0, bad, 0] },
          'p',
        ),
      )
      expect(issue).toMatchObject({
        code: 'INVALID_VALUE',
        field: '$value.components[1]',
      })
    },
  )

  it('collects every bad component, not just the first', () => {
    const result = validateLiteral(
      'color',
      { colorSpace: 'srgb', components: [2, 0, -1] },
      'p',
    )
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.field)).toEqual([
      '$value.components[0]',
      '$value.components[2]',
    ])
  })

  it('reports the "none" keyword as UNSUPPORTED_FEATURE', () => {
    const issue = singleIssue(
      validateLiteral(
        'color',
        { colorSpace: 'srgb', components: [0, 'none', 0] },
        'p',
      ),
    )
    expect(issue).toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      field: '$value.components[1]',
    })
  })

  it('reports a property-level $ref as UNSUPPORTED_FEATURE', () => {
    const issue = singleIssue(
      validateLiteral(
        'color',
        {
          colorSpace: 'srgb',
          components: [{ $ref: '#/base/blue/$value/components/0' }, 0, 0],
        },
        'p',
      ),
    )
    expect(issue).toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      field: '$value.components[0]',
    })
  })

  it.each([[2], [-0.5], ['1'], [Number.NaN]])('rejects alpha %j', (alpha) => {
    const issue = singleIssue(
      validateLiteral(
        'color',
        { colorSpace: 'srgb', components: [0, 0, 0], alpha },
        'p',
      ),
    )
    expect(issue).toMatchObject({
      code: 'INVALID_VALUE',
      field: '$value.alpha',
    })
  })

  it.each(['#fff', '#ff00ff80', 'ff00ff', '#gg0000', 12, ''])(
    'rejects hex %j',
    (hex) => {
      const issue = singleIssue(
        validateLiteral(
          'color',
          { colorSpace: 'srgb', components: [0, 0, 0], hex },
          'p',
        ),
      )
      expect(issue).toMatchObject({
        code: 'INVALID_VALUE',
        field: '$value.hex',
      })
    },
  )

  it('rejects unknown properties', () => {
    const issue = singleIssue(
      validateLiteral(
        'color',
        { colorSpace: 'srgb', components: [0, 0, 0], extra: 1 },
        'p',
      ),
    )
    expect(issue).toMatchObject({
      code: 'INVALID_VALUE',
      field: '$value.extra',
    })
  })

  describe('HEX_MISMATCH (tolerance of +/-1 per 8-bit channel)', () => {
    const color = (components: number[], hex: string) =>
      validateLiteral('color', { colorSpace: 'srgb', components, hex }, 'p')

    it('accepts both neighbours of a half-way value', () => {
      expect(color([0.5, 0.5, 0.5], '#7f7f7f').issues).toEqual([])
      expect(color([0.5, 0.5, 0.5], '#808080').issues).toEqual([])
    })

    it('accepts a difference of exactly 1 in a channel', () => {
      expect(color([1, 0, 0], '#fe0000').issues).toEqual([])
      expect(color([1, 0, 0], '#000000').issues).not.toEqual([])
      expect(color([0, 0, 0], '#000001').issues).toEqual([])
    })

    it('warns at a difference of 2 and keeps the token valid', () => {
      const result = color([1, 0, 0], '#fd0000')
      expect(result.ok).toBe(true)
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]).toMatchObject({
        code: 'HEX_MISMATCH',
        severity: 'warning',
        path: 'p',
        field: '$value.hex',
      })
    })

    it('warns when only one channel is off by 2', () => {
      const result = color([0, 0, 0], '#000002')
      expect(result.issues.map((issue) => issue.code)).toEqual(['HEX_MISMATCH'])
    })

    it('compares hex case-insensitively', () => {
      expect(color([1, 0, 1], '#FF00FF').issues).toEqual([])
    })

    it('does not warn when hex is absent', () => {
      const result = validateLiteral(
        'color',
        { colorSpace: 'srgb', components: [0.3, 0.3, 0.3] },
        'p',
      )
      expect(result.issues).toEqual([])
    })
  })
})

describe('validateLiteral: dimension', () => {
  it.each([
    [{ value: 16, unit: 'px' }],
    [{ value: 0.5, unit: 'rem' }],
    [{ value: 0, unit: 'px' }],
    [{ value: -4, unit: 'px' }],
  ])('accepts %j', (raw) => {
    const result = validateLiteral('dimension', raw, 'p')
    expect(result).toEqual({ ok: true, value: raw, issues: [] })
  })

  it.each([['16px'], [16], [null], [[16, 'px']]])(
    'rejects non-object %j',
    (raw) => {
      expect(singleIssue(validateLiteral('dimension', raw, 'p'))).toMatchObject(
        { code: 'INVALID_VALUE', field: '$value' },
      )
    },
  )

  it.each(['em', '%', 'PX', '', 1])('rejects unit %j', (unit) => {
    expect(
      singleIssue(validateLiteral('dimension', { value: 1, unit }, 'p')),
    ).toMatchObject({ code: 'INVALID_VALUE', field: '$value.unit' })
  })

  it('requires the unit even when value is 0', () => {
    expect(
      singleIssue(validateLiteral('dimension', { value: 0 }, 'p')),
    ).toMatchObject({ code: 'INVALID_VALUE', field: '$value.unit' })
  })

  it.each(['16', null, Number.NaN, Infinity, undefined])(
    'rejects value %j',
    (value) => {
      expect(
        singleIssue(validateLiteral('dimension', { value, unit: 'px' }, 'p')),
      ).toMatchObject({ code: 'INVALID_VALUE', field: '$value.value' })
    },
  )

  it('reports a property-level $ref as UNSUPPORTED_FEATURE', () => {
    expect(
      singleIssue(
        validateLiteral(
          'dimension',
          { value: { $ref: '#/base/spacing/$value/value' }, unit: 'px' },
          'p',
        ),
      ),
    ).toMatchObject({ code: 'UNSUPPORTED_FEATURE', field: '$value.value' })
  })

  it('rejects unknown properties', () => {
    expect(
      singleIssue(
        validateLiteral('dimension', { value: 1, unit: 'px', extra: 1 }, 'p'),
      ),
    ).toMatchObject({ code: 'INVALID_VALUE', field: '$value.extra' })
  })
})

describe('validateLiteral: fontFamily', () => {
  it('accepts a single name and a list, copying the list', () => {
    expect(validateLiteral('fontFamily', 'Inter', 'p').ok).toBe(true)
    const list = ['Helvetica', 'Arial', 'sans-serif']
    const result = validateLiteral('fontFamily', list, 'p')
    expect(result).toEqual({ ok: true, value: list, issues: [] })
    if (result.ok) expect(result.value).not.toBe(list)
  })

  it.each([[''], ['   '], [[]], [['Inter', '']], [['Inter', 3]], [42], [null]])(
    'rejects %j',
    (raw) => {
      expect(
        validateLiteral('fontFamily', raw, 'p').issues.map(
          (issue) => issue.code,
        ),
      ).toEqual(['INVALID_VALUE'])
    },
  )

  it('reports a reference inside an array as UNSUPPORTED_FEATURE', () => {
    expect(
      singleIssue(validateLiteral('fontFamily', ['{font.base}', 'Arial'], 'p')),
    ).toMatchObject({ code: 'UNSUPPORTED_FEATURE', field: '$value[0]' })
  })
})

describe('validateLiteral: fontWeight', () => {
  it.each([1, 350, 400, 1000])('accepts the number %d', (weight) => {
    expect(validateLiteral('fontWeight', weight, 'p').ok).toBe(true)
  })

  it.each(FONT_WEIGHT_NAMES)('accepts the name %j', (name) => {
    expect(validateLiteral('fontWeight', name, 'p').ok).toBe(true)
  })

  it.each([
    0,
    1001,
    -1,
    Number.NaN,
    Infinity,
    'Bold',
    'BOLD',
    'semibold',
    '400',
    '',
    null,
  ])('rejects %j', (raw) => {
    expect(
      validateLiteral('fontWeight', raw, 'p').issues.map((issue) => issue.code),
    ).toEqual(['INVALID_VALUE'])
  })
})

describe('validateLiteral: number', () => {
  it.each([0, 1, -1.5, 2.3, 1e21])('accepts %d', (value) => {
    expect(validateLiteral('number', value, 'p')).toEqual({
      ok: true,
      value,
      issues: [],
    })
  })

  it.each(['1', null, Number.NaN, Infinity, -Infinity, {}, [1], undefined])(
    'rejects %j',
    (raw) => {
      expect(
        validateLiteral('number', raw, 'p').issues.map((issue) => issue.code),
      ).toEqual(['INVALID_VALUE'])
    },
  )
})
