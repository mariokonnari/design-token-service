import { builtinModules } from 'node:module'
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Boundary rules, see docs/decisions/0005-linting-and-boundaries.md.
const tokensCoreForbidden = [
  'react',
  'react-dom',
  'express',
  // Bare Node built-ins ('fs', 'path', ...) as well as the 'node:' forms.
  ...builtinModules,
]

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/storybook-static/**',
  ]),

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Browser code: the Theme Editor and the component library.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: { globals: globals.browser },
  },

  // Node code: the API, scripts and tool configs.
  {
    files: [
      'apps/api/**',
      'scripts/**',
      'packages/*/scripts/**',
      'eslint.config.mjs',
      '**/*.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  // Boundary 1: packages/ui source must not import tokens-core. Build scripts
  // outside src/ may (ADR 0001/0002: build-time generation of the default theme).
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@dts/tokens-core',
              message:
                'packages/ui/src must not import @dts/tokens-core: components only read CSS custom properties. Build scripts outside src/ may.',
            },
          ],
          patterns: [
            {
              group: ['@dts/tokens-core/*'],
              message:
                'packages/ui/src must not import @dts/tokens-core: components only read CSS custom properties. Build scripts outside src/ may.',
            },
          ],
        },
      ],
    },
  },

  // Boundary 2: tokens-core source is pure logic (no React, Express or Node).
  // Tests and config files are exempt.
  {
    files: ['packages/tokens-core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: tokensCoreForbidden.map((name) => ({
            name,
            message:
              'packages/tokens-core/src must stay pure: no react, react-dom, express or Node built-ins.',
          })),
          patterns: [
            {
              group: ['node:*', 'react/*', 'react-dom/*', 'express/*'],
              message:
                'packages/tokens-core/src must stay pure: no react, react-dom, express or Node built-ins.',
            },
          ],
        },
      ],
    },
  },
])
