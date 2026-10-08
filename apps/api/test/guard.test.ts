import { describe, expect, it } from 'vitest'
import { assertTestDatabase, databaseNameOf } from './support/guard'

// The tests TRUNCATE every table, so the guard that refuses a non-test database
// is itself tested, including the cases where a real database name sits close
// to an accepted one.

const url = (database: string, query = '') =>
  `postgresql://user:s3cret@localhost:5433/${database}${query}`

describe('assertTestDatabase', () => {
  it.each([
    'dts_test',
    'foo_test',
    'a_test',
    'my_app_test',
    'x1_test',
    'dts_test?schema=public',
  ])('accepts %s', (database) => {
    expect(() => assertTestDatabase(url(database))).not.toThrow()
    expect(assertTestDatabase(url(database))).toBe(url(database))
  })

  it('accepts a URL with a query string', () => {
    expect(() =>
      assertTestDatabase(url('dts_test', '?connection_limit=5')),
    ).not.toThrow()
  })

  it.each([
    'dts_dev',
    'dts',
    'postgres',
    'production',
    'test',
    'dts_test_shadow',
    'dts_test2',
    'dts_testing',
    'dts-test',
    'dts_TEST',
    'Dts_test_',
    'dts_dev_test_backup',
  ])('refuses %s', (database) => {
    // `dts_dev_test_backup` and friends do not END in _test.
    expect(() => assertTestDatabase(url(database))).toThrow(/Refusing/)
  })

  it('refuses a name that ends in _test but is not a safe identifier', () => {
    expect(() => assertTestDatabase(url('a%22b_test'))).toThrow(
      /lowercase letters, digits and underscores/,
    )
    expect(() => assertTestDatabase(url('Mixed_test'))).toThrow(
      /lowercase letters/,
    )
  })

  it.each([undefined, '', '   '])('refuses a missing URL (%j)', (value) => {
    expect(() => assertTestDatabase(value)).toThrow(/not set/)
  })

  it('refuses a malformed URL without echoing it', () => {
    expect(() => assertTestDatabase('not a url')).toThrow(/not a valid URL/)
    try {
      assertTestDatabase('not a url')
    } catch (error) {
      expect(String(error)).not.toContain('not a url')
    }
  })

  it('never puts the password in the error message', () => {
    try {
      assertTestDatabase(url('dts_dev'))
      throw new Error('expected a throw')
    } catch (error) {
      const message = String(error)
      expect(message).toContain('dts_dev')
      expect(message).toContain('localhost:5433')
      expect(message).not.toContain('s3cret')
    }
  })
})

describe('databaseNameOf', () => {
  it('reads the database name and decodes it', () => {
    expect(databaseNameOf(url('dts_test'))).toBe('dts_test')
    expect(databaseNameOf(url('dts_test', '?x=1'))).toBe('dts_test')
    expect(databaseNameOf(url('a%20b'))).toBe('a b')
  })
})
