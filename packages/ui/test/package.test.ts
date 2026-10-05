import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GENERATED_CSS_PATH } from '../scripts/lib/buildThemes'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe('@dts/ui package.json', () => {
  it('exposes the entry point and the generated themes as source files (ADR 0003)', () => {
    expect(pkg.exports).toEqual({
      '.': './src/index.ts',
      './themes.css': './src/themes.generated.css',
    })
  })

  it('every exports target exists and none points at a build output', () => {
    for (const target of Object.values(pkg.exports)) {
      expect(existsSync(join(root, target)), target).toBe(true)
      expect(target).not.toMatch(/dist/)
    }
  })

  it('the themes.css export is the file the generator writes', () => {
    expect(relative(root, GENERATED_CSS_PATH).replaceAll('\\', '/')).toBe(
      pkg.exports['./themes.css']?.replace('./', ''),
    )
  })

  it('uses tokens-core only as a devDependency (build and test time), never at runtime', () => {
    expect(pkg.devDependencies).toHaveProperty('@dts/tokens-core')
    expect(pkg.dependencies ?? {}).not.toHaveProperty('@dts/tokens-core')
    expect(pkg.peerDependencies ?? {}).not.toHaveProperty('@dts/tokens-core')
  })
})
