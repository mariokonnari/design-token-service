import { cssVarName } from '@dts/tokens-core'
import { Button } from '@dts/ui'

export default function App() {
  return (
    <main>
      <h1>Design Token Service</h1>
      <p>
        <code>{cssVarName('color.blue.500')}</code>
      </p>
      <Button>Placeholder</Button>
    </main>
  )
}
