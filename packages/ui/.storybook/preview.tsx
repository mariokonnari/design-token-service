import type { Decorator, Preview } from '@storybook/react-vite'
import '../src/themes.generated.css'
import { ThemeScope } from '../src/ThemeScope/ThemeScope'
import { THEMES, type Theme } from './themes'

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value)
}

/** Wraps every story in ThemeScope for the theme chosen in the toolbar. */
const withTheme: Decorator = (Story, context) => {
  const chosen: unknown = context.globals['theme']
  const theme = isTheme(chosen) ? chosen : THEMES[0]
  return (
    <ThemeScope
      theme={theme}
      style={{
        background: 'var(--semantic-color-surface)',
        color: 'var(--semantic-color-text)',
        fontFamily: 'var(--semantic-font-family-sans)',
        padding: '1rem',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <Story />
    </ThemeScope>
  )
}

const preview: Preview = {
  initialGlobals: { theme: THEMES[0] },
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: THEMES.map((theme) => ({ value: theme, title: theme })),
        dynamicTitle: true,
      },
    },
  },
  decorators: [withTheme],
  parameters: { layout: 'fullscreen' },
}

export default preview
