import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { createRef, useState, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Tab, TabList, TabPanel, Tabs } from './index'

// jsdom has no layout, so contrast, focus rings and sizes are checked in the
// real-browser suite (packages/ui/e2e). This file checks the ARIA wiring and
// the keyboard behaviour.

function Example(props: Omit<ComponentProps<typeof Tabs>, 'children'>) {
  return (
    <Tabs {...props}>
      <TabList aria-label="Demo">
        <Tab value="a">Alpha</Tab>
        <Tab value="b">Beta</Tab>
        <Tab value="c" disabled>
          Gamma
        </Tab>
        <Tab value="d">Delta</Tab>
      </TabList>
      <TabPanel value="a">Panel A</TabPanel>
      <TabPanel value="b">Panel B</TabPanel>
      <TabPanel value="c">Panel C</TabPanel>
      <TabPanel value="d">Panel D</TabPanel>
    </Tabs>
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })
const selectedName = () =>
  screen
    .getAllByRole('tab')
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent
const focused = () => document.activeElement

describe('Tabs: ARIA wiring', () => {
  it('renders a tablist with tabs and marks exactly the selected one', () => {
    render(<Example defaultValue="b" />)
    expect(screen.getByRole('tablist', { name: 'Demo' })).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(tab('Beta').getAttribute('aria-selected')).toBe('true')
    for (const name of ['Alpha', 'Gamma', 'Delta']) {
      expect(tab(name).getAttribute('aria-selected')).toBe('false')
    }
  })

  it('links every tab to a real panel and every panel back to its tab', () => {
    const { container } = render(<Example defaultValue="a" />)
    for (const t of screen.getAllByRole('tab')) {
      const panelId = t.getAttribute('aria-controls')
      expect(panelId).toBeTruthy()
      const panel = container.ownerDocument.getElementById(panelId ?? '')
      expect(panel, `panel ${panelId}`).not.toBeNull()
      expect(panel?.getAttribute('role')).toBe('tabpanel')
      expect(panel?.getAttribute('aria-labelledby')).toBe(t.id)
      expect(container.ownerDocument.getElementById(t.id)).toBe(t)
    }
  })

  it('keeps every panel in the DOM and hides the unselected ones with hidden', () => {
    const { container } = render(<Example defaultValue="a" />)
    const panels = container.querySelectorAll('[role="tabpanel"]')
    expect(panels).toHaveLength(4)
    expect([...panels].map((p) => p.hasAttribute('hidden'))).toEqual([
      false,
      true,
      true,
      true,
    ])
    // Hidden panels keep their content (aria-controls always resolves).
    expect(container.textContent).toContain('Panel D')
  })

  it('gives every panel tabindex 0', () => {
    const { container } = render(<Example defaultValue="a" />)
    for (const panel of container.querySelectorAll('[role="tabpanel"]')) {
      expect(panel.getAttribute('tabindex')).toBe('0')
    }
  })

  it('resolves ids for a value with a space and other awkward characters', () => {
    const awkward = ['a b', 'x/y?z', 'é ü', '100%']
    const { container } = render(
      <Tabs defaultValue="a b">
        <TabList aria-label="Awkward">
          {awkward.map((v) => (
            <Tab key={v} value={v}>
              {v}
            </Tab>
          ))}
        </TabList>
        {awkward.map((v) => (
          <TabPanel key={v} value={v}>
            panel {v}
          </TabPanel>
        ))}
      </Tabs>,
    )
    const ids = new Set<string>()
    for (const t of screen.getAllByRole('tab')) {
      expect(/\s/.test(t.id)).toBe(false)
      ids.add(t.id)
      const panel = container.ownerDocument.getElementById(
        t.getAttribute('aria-controls') ?? '',
      )
      expect(panel?.getAttribute('aria-labelledby')).toBe(t.id)
    }
    expect(ids.size).toBe(awkward.length)
  })

  it('gives two Tabs instances with the same values distinct ids', () => {
    const { container } = render(
      <>
        <Example defaultValue="a" />
        <Example defaultValue="a" />
      </>,
    )
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sets aria-orientation on the tablist', () => {
    const { rerender } = render(<Example defaultValue="a" />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe(
      'horizontal',
    )
    rerender(<Example defaultValue="a" orientation="vertical" />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe(
      'vertical',
    )
  })
})

describe('Tabs: roving tabindex', () => {
  it('puts only the selected tab in the tab order', () => {
    render(<Example defaultValue="b" />)
    expect(tab('Beta').getAttribute('tabindex')).toBe('0')
    for (const name of ['Alpha', 'Gamma', 'Delta']) {
      expect(tab(name).getAttribute('tabindex')).toBe('-1')
    }
  })

  it('moves tabindex 0 to the newly selected tab', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="a" />)
    await user.click(tab('Delta'))
    expect(tab('Delta').getAttribute('tabindex')).toBe('0')
    expect(tab('Alpha').getAttribute('tabindex')).toBe('-1')
  })

  it('moves focus from the tablist into the selected panel with Tab', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="b" />)
    await user.tab()
    expect(focused()).toBe(tab('Beta'))
    await user.tab()
    expect(focused()).toBe(screen.getByText('Panel B'))
  })
})

describe('Tabs: keyboard navigation (horizontal)', () => {
  it('ArrowRight and ArrowLeft move focus, skip disabled tabs and wrap', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="a" />)
    await user.tab()
    expect(focused()).toBe(tab('Alpha'))
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Beta'))
    await user.keyboard('{ArrowRight}') // Gamma is disabled
    expect(focused()).toBe(tab('Delta'))
    await user.keyboard('{ArrowRight}') // wraps
    expect(focused()).toBe(tab('Alpha'))
    await user.keyboard('{ArrowLeft}') // wraps backwards
    expect(focused()).toBe(tab('Delta'))
    await user.keyboard('{ArrowLeft}')
    expect(focused()).toBe(tab('Beta'))
  })

  it('Home and End jump to the first and last enabled tab', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="b" />)
    await user.tab()
    await user.keyboard('{End}')
    expect(focused()).toBe(tab('Delta'))
    await user.keyboard('{Home}')
    expect(focused()).toBe(tab('Alpha'))
  })

  it('ignores the vertical arrow keys when horizontal', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="a" />)
    await user.tab()
    await user.keyboard('{ArrowDown}{ArrowUp}')
    expect(focused()).toBe(tab('Alpha'))
  })
})

describe('Tabs: keyboard navigation (vertical)', () => {
  it('ArrowDown and ArrowUp move focus and wrap; horizontal arrows are ignored', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="a" orientation="vertical" />)
    await user.tab()
    await user.keyboard('{ArrowRight}{ArrowLeft}')
    expect(focused()).toBe(tab('Alpha'))
    await user.keyboard('{ArrowDown}')
    expect(focused()).toBe(tab('Beta'))
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(focused()).toBe(tab('Delta'))
  })
})

describe('Tabs: activation', () => {
  it('automatic (the default): arrow keys select as they move focus', async () => {
    const user = userEvent.setup()
    const { container } = render(<Example defaultValue="a" />)
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(selectedName()).toBe('Beta')
    expect(
      container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent,
    ).toBe('Panel B')
    await user.keyboard('{End}')
    expect(selectedName()).toBe('Delta')
  })

  it('manual: arrow keys only move focus; Enter or Space selects', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="a" activationMode="manual" />)
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Beta'))
    expect(selectedName()).toBe('Alpha')
    await user.keyboard('{Enter}')
    expect(selectedName()).toBe('Beta')
    await user.keyboard('{ArrowRight}')
    expect(focused()).toBe(tab('Delta'))
    expect(selectedName()).toBe('Beta')
    await user.keyboard(' ')
    expect(selectedName()).toBe('Delta')
  })

  it('clicking selects in manual mode too', async () => {
    const user = userEvent.setup()
    render(<Example defaultValue="a" activationMode="manual" />)
    await user.click(tab('Delta'))
    expect(selectedName()).toBe('Delta')
  })
})

describe('Tabs: disabled tabs', () => {
  it('cannot be selected by click or reached by keyboard', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Example defaultValue="a" onValueChange={onValueChange} />)
    expect((tab('Gamma') as HTMLButtonElement).disabled).toBe(true)
    await user.click(tab('Gamma'))
    expect(selectedName()).toBe('Alpha')
    expect(onValueChange).not.toHaveBeenCalled()
    await user.tab()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(focused()).not.toBe(tab('Gamma'))
  })
})

describe('Tabs: controlled and uncontrolled', () => {
  it('uncontrolled: keeps its own state and reports changes', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Example defaultValue="a" onValueChange={onValueChange} />)
    await user.click(tab('Beta'))
    expect(selectedName()).toBe('Beta')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('does not report a change when the selected tab is clicked again', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Example defaultValue="a" onValueChange={onValueChange} />)
    await user.click(tab('Alpha'))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('controlled: the value prop is authoritative and changes are only requested', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Example value="a" onValueChange={onValueChange} />)
    await user.click(tab('Beta'))
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('b')
    expect(selectedName()).toBe('Alpha') // the parent did not update the prop
  })

  it('controlled: follows the parent when it updates the value', async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [value, setValue] = useState('a')
      return <Example value={value} onValueChange={setValue} />
    }
    const { container } = render(<Controlled />)
    await user.click(tab('Delta'))
    expect(selectedName()).toBe('Delta')
    expect(
      container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent,
    ).toBe('Panel D')
    expect(tab('Delta').getAttribute('tabindex')).toBe('0')
  })
})

describe('Tabs: props and refs', () => {
  it('forwards refs and appends className without leaking its own props to the DOM', () => {
    const root = createRef<HTMLDivElement>()
    const list = createRef<HTMLDivElement>()
    const button = createRef<HTMLButtonElement>()
    const panel = createRef<HTMLDivElement>()
    render(
      <Tabs
        ref={root}
        className="mine"
        defaultValue="a"
        activationMode="manual"
        orientation="vertical"
      >
        <TabList ref={list} aria-label="x" className="mine-list">
          <Tab ref={button} value="a" className="mine-tab">
            A
          </Tab>
        </TabList>
        <TabPanel ref={panel} value="a" className="mine-panel">
          panel
        </TabPanel>
      </Tabs>,
    )
    expect(root.current).toBeInstanceOf(HTMLDivElement)
    expect(list.current).toBeInstanceOf(HTMLDivElement)
    expect(button.current).toBeInstanceOf(HTMLButtonElement)
    expect(panel.current).toBeInstanceOf(HTMLDivElement)
    expect(root.current?.className).toBe('dts-tabs mine')
    expect(list.current?.className).toBe('dts-tabs__list mine-list')
    expect(button.current?.className).toBe('dts-tabs__tab mine-tab')
    expect(panel.current?.className).toBe('dts-tabs__panel mine-panel')
    const attributes = [...(root.current?.attributes ?? [])].map((a) => a.name)
    expect(attributes).not.toContain('activationmode')
    expect(attributes).not.toContain('orientation')
    expect(attributes).not.toContain('defaultvalue')
    expect(button.current?.getAttribute('type')).toBe('button')
  })

  it('runs the caller keydown handler as well as its own', async () => {
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    render(
      <Tabs defaultValue="a">
        <TabList aria-label="x" onKeyDown={onKeyDown}>
          <Tab value="a">A</Tab>
          <Tab value="b">B</Tab>
        </TabList>
        <TabPanel value="a">a</TabPanel>
        <TabPanel value="b">b</TabPanel>
      </Tabs>,
    )
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(onKeyDown).toHaveBeenCalled()
    expect(focused()).toBe(tab('B'))
  })

  it('throws a readable error when a part is used outside Tabs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Tab value="a">A</Tab>)).toThrow(/inside <Tabs>/)
    spy.mockRestore()
  })
})

describe('Tabs: axe', () => {
  it.each([
    ['default', <Example key="1" defaultValue="a" />],
    ['vertical', <Example key="2" defaultValue="b" orientation="vertical" />],
    ['manual', <Example key="3" defaultValue="a" activationMode="manual" />],
    [
      'controlled',
      <Example key="4" value="d" onValueChange={() => undefined} />,
    ],
  ])('has no violations: %s', async (_name, ui) => {
    const { container } = render(ui)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no violations after the selection changes', async () => {
    const user = userEvent.setup()
    const { container } = render(<Example defaultValue="a" />)
    await user.click(tab('Delta'))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('the axe wiring can fail: a tab without an accessible name is reported', async () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabList aria-label="x">
          <Tab value="a" />
        </TabList>
        <TabPanel value="a">p</TabPanel>
      </Tabs>,
    )
    const results = await axe(container)
    expect(results.violations.length).toBeGreaterThan(0)
  })
})
