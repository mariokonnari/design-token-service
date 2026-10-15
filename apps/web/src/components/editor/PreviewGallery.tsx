import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
  ThemeScope,
} from '@dts/ui'
import { useEffect, useId, useState } from 'react'
import {
  PREVIEW_STYLE_ATTRIBUTE,
  PREVIEW_THEME,
  applyPreviewStyle,
} from '../../editor/preview'

/**
 * Writes the preview CSS into the document head (one `<style data-dts-preview>`,
 * textContent only) and removes it when the editor goes away.
 */
export function PreviewStyle({ css }: { css: string }) {
  useEffect(() => {
    applyPreviewStyle(document, css)
  }, [css])
  useEffect(
    () => () => {
      document.head
        .querySelectorAll(`style[${PREVIEW_STYLE_ATTRIBUTE}]`)
        .forEach((node) => {
          node.remove()
        })
    },
    [],
  )
  return null
}

/**
 * The @dts/ui components inside `data-theme="preview"`. Everything the draft does
 * not define falls back to the surrounding default theme through the cascade. The
 * editor itself stays in the default theme. Only library components are shown:
 * this is not a preview of any other page.
 */
export function PreviewGallery() {
  const headingId = useId()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <section aria-labelledby={headingId} className="preview">
      <h2 id={headingId}>Live preview</h2>
      <p className="muted">This preview shows @dts/ui components only.</p>
      <ThemeScope theme={PREVIEW_THEME} className="preview__stage">
        <div className="preview__row">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary action</Button>
          <Button disabled>Disabled action</Button>
        </div>
        <TextField
          label="Preview text field"
          description="Helper text sits under the label."
          defaultValue="Some text"
        />
        <TextField
          label="Preview text field with an error"
          error="This is how an error looks."
          defaultValue="Oops"
        />
        <Select label="Preview select" defaultValue="two">
          <option value="one">First option</option>
          <option value="two">Second option</option>
        </Select>
        <Checkbox label="Preview checkbox" defaultChecked />
        <Alert variant="info" title="Information">
          <p>An informational message.</p>
        </Alert>
        <Alert variant="success" title="Success">
          <p>A success message.</p>
        </Alert>
        <Alert variant="warning" title="Warning">
          <p>A warning message.</p>
        </Alert>
        <Alert variant="danger" title="Danger">
          <p>An error message.</p>
        </Alert>
        <Tabs defaultValue="one">
          <TabList aria-label="Preview tabs">
            <Tab value="one">First tab</Tab>
            <Tab value="two">Second tab</Tab>
          </TabList>
          <TabPanel value="one">Content of the first tab.</TabPanel>
          <TabPanel value="two">Content of the second tab.</TabPanel>
        </Tabs>
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setDialogOpen(true)
            }}
          >
            Open preview dialog
          </Button>
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title="Preview dialog"
            description="A dialog inside the preview theme."
          >
            <p>Dialog content.</p>
          </Dialog>
        </div>
      </ThemeScope>
    </section>
  )
}
