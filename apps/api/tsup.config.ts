import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  clean: true,
  // Workspace packages export raw .ts (see ADR 0003). tsup externalizes
  // `dependencies` by default, which would leave an import of a .ts file that
  // plain Node cannot load, so these must be bundled.
  noExternal: ['@dts/tokens-core'],
})
