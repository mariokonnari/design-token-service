import {
  useCallback,
  useId,
  useMemo,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
} from 'react'
import {
  TabsProvider,
  panelId,
  tabId,
  useTabsContext,
  type TabsActivationMode,
  type TabsOrientation,
} from './TabsContext'
import './Tabs.css'

/*
 * Compound tabs following the WAI-ARIA tabs pattern.
 *
 * Known limitations (see ADR 0011):
 * - `value` / `defaultValue` must match an ENABLED Tab. Otherwise no tab has
 *   tabindex 0 and the list cannot be reached with the keyboard.
 * - Tab values must be unique within one Tabs; duplicates produce duplicate ids.
 * - No RTL key reversal: ArrowLeft/ArrowRight keep their physical meaning.
 * - No overflow or scrolling handling for long tab lists.
 * - The selected label is bolder, so its tab can be slightly wider than the others.
 * - Disabled tabs use the native `disabled` attribute: they are skipped by the
 *   keyboard and by screen reader tabbing (the ARIA pattern also allows
 *   keeping them focusable with aria-disabled).
 * - Every panel has tabindex 0, which adds a tab stop when the visible panel
 *   also has focusable content.
 */

export type TabsProps = Omit<ComponentPropsWithRef<'div'>, 'defaultValue'> & {
  /** Controlled selected value. Use together with `onValueChange`. */
  value?: string
  /** Initial value when uncontrolled. */
  defaultValue?: string
  /** Called with the new value when the user selects a different tab. */
  onValueChange?: (value: string) => void
  /** `automatic` selects on focus (arrow keys); `manual` needs Enter or Space. */
  activationMode?: TabsActivationMode
  orientation?: TabsOrientation
}

export function Tabs({
  value: valueProp,
  defaultValue,
  onValueChange,
  activationMode = 'automatic',
  orientation = 'horizontal',
  className,
  ref,
  ...rest
}: TabsProps) {
  const baseId = useId()
  const [innerValue, setInnerValue] = useState(defaultValue)
  const controlled = valueProp !== undefined
  const value = controlled ? valueProp : innerValue

  const select = useCallback(
    (next: string) => {
      if (next === value) return
      if (!controlled) setInnerValue(next)
      onValueChange?.(next)
    },
    [controlled, onValueChange, value],
  )

  const context = useMemo(
    () => ({ baseId, value, select, orientation, activationMode }),
    [baseId, value, select, orientation, activationMode],
  )

  return (
    <TabsProvider value={context}>
      <div
        {...rest}
        ref={ref}
        data-orientation={orientation}
        className={className ? `dts-tabs ${className}` : 'dts-tabs'}
      />
    </TabsProvider>
  )
}

export type TabListProps = Omit<ComponentPropsWithRef<'div'>, 'role'>

/**
 * The tablist itself is not focusable (roving tabindex puts the selected Tab in
 * the tab order), so the keyboard handling lives on each Tab.
 */
export function TabList({ className, ref, ...rest }: TabListProps) {
  const { orientation } = useTabsContext('TabList')

  return (
    <div
      {...rest}
      ref={ref}
      role="tablist"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={className ? `dts-tabs__list ${className}` : 'dts-tabs__list'}
    />
  )
}

export type TabProps = Omit<
  ComponentPropsWithRef<'button'>,
  'value' | 'role' | 'type'
> & {
  /** Unique within its Tabs; pairs the tab with the TabPanel of the same value. */
  value: string
}

export function Tab({
  value,
  className,
  ref,
  onClick,
  onKeyDown,
  ...rest
}: TabProps) {
  const context = useTabsContext('Tab')
  const selected = context.value === value
  const next = context.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const previous =
    context.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.altKey || event.ctrlKey || event.metaKey) return

    // Enabled tabs of this tablist in DOM order; disabled ones are skipped.
    const list = event.currentTarget.closest('[role="tablist"]')
    if (list === null) return
    const tabs = Array.from(
      list.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'),
    )
    const current = tabs.indexOf(event.currentTarget)
    if (current === -1) return

    let index: number
    switch (event.key) {
      case next:
        index = (current + 1) % tabs.length
        break
      case previous:
        index = (current - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        index = 0
        break
      case 'End':
        index = tabs.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const target = tabs[index]
    if (target === undefined) return
    target.focus()
    if (context.activationMode === 'automatic') {
      const targetValue = target.getAttribute('data-tab-value')
      if (targetValue !== null) context.select(targetValue)
    }
  }

  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      role="tab"
      id={tabId(context.baseId, value)}
      aria-selected={selected}
      aria-controls={panelId(context.baseId, value)}
      tabIndex={selected ? 0 : -1}
      data-tab-value={value}
      data-state={selected ? 'selected' : 'unselected'}
      data-orientation={context.orientation}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) context.select(value)
      }}
      onKeyDown={handleKeyDown}
      className={className ? `dts-tabs__tab ${className}` : 'dts-tabs__tab'}
    />
  )
}
export type TabPanelProps = Omit<
  ComponentPropsWithRef<'div'>,
  'role' | 'hidden'
> & {
  value: string
}

/** All panels stay mounted; the unselected ones are `hidden`, so aria-controls always resolves. */
export function TabPanel({ value, className, ref, ...rest }: TabPanelProps) {
  const context = useTabsContext('TabPanel')
  const selected = context.value === value

  return (
    <div
      {...rest}
      ref={ref}
      role="tabpanel"
      id={panelId(context.baseId, value)}
      aria-labelledby={tabId(context.baseId, value)}
      tabIndex={0}
      hidden={!selected}
      className={className ? `dts-tabs__panel ${className}` : 'dts-tabs__panel'}
    />
  )
}
