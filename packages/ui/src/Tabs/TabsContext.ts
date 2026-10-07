import { createContext, use } from 'react'

export type TabsOrientation = 'horizontal' | 'vertical'
export type TabsActivationMode = 'automatic' | 'manual'

export interface TabsContextValue {
  /** From useId: makes the ids of two Tabs instances distinct. */
  baseId: string
  value: string | undefined
  select: (value: string) => void
  orientation: TabsOrientation
  activationMode: TabsActivationMode
}

const TabsContext = createContext<TabsContextValue | null>(null)

export const TabsProvider = TabsContext

export function useTabsContext(part: string): TabsContextValue {
  const context = use(TabsContext)
  if (context === null) {
    throw new Error(`<${part}> must be used inside <Tabs>.`)
  }
  return context
}

/** Ids are derived from the instance id and the value; the value is encoded so a space or slash stays a valid id. */
export function tabId(baseId: string, value: string): string {
  return `${baseId}-tab-${encodeURIComponent(value)}`
}

export function panelId(baseId: string, value: string): string {
  return `${baseId}-panel-${encodeURIComponent(value)}`
}
