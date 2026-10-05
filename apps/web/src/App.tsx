import { cssVarName } from '@dts/tokens-core'
import { Button, ThemeScope } from '@dts/ui'
import '@dts/ui/themes.css'

export default function App() {
  return (
    <ThemeScope theme="default">
      <main>
        <h1>Design Token Service</h1>
        <p>
          <code>{cssVarName('color.blue.500')}</code>
        </p>
        <Button>Placeholder</Button>
      </main>
    </ThemeScope>
  )
}
