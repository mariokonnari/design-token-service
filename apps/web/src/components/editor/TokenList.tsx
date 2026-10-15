import { Button, Tab, TabList, TabPanel, Tabs, TextField } from '@dts/ui'
import { tierOf } from '@dts/tokens-core'
import { useMemo, useState, type Ref } from 'react'
import {
  filterItems,
  groupByTier,
  type Group,
  type ListItem,
} from '../../editor/groups'

type TierTab = 'primitive' | 'semantic' | 'component' | 'other'

const TIER_LABEL: Record<TierTab, string> = {
  primitive: 'Primitive',
  semantic: 'Semantic',
  component: 'Component',
  other: 'Other',
}

function tierTabOf(path: string): TierTab {
  return tierOf(path) ?? 'other'
}

function Swatch({ color }: { color: string }) {
  // Decorative: the value is ALWAYS also present as text. `color` is a #rrggbb string we produced.
  return (
    <span
      className="swatch"
      aria-hidden="true"
      style={{ backgroundColor: color }}
    />
  )
}

function ItemButton({
  item,
  selected,
  onSelect,
}: {
  item: ListItem
  selected: boolean
  onSelect: (path: string) => void
}) {
  return (
    <button
      type="button"
      className="token-item"
      aria-current={selected ? 'true' : undefined}
      onClick={() => {
        onSelect(item.path)
      }}
    >
      {item.swatch === undefined ? null : <Swatch color={item.swatch} />}
      <span className="token-item__path">{item.path}</span>{' '}
      <span className="token-item__type">
        {item.unreadable === true ? 'unreadable' : (item.type ?? 'unresolved')}
      </span>{' '}
      <span className="token-item__value">{item.display}</span>
    </button>
  )
}

function Groups({
  groups,
  selectedPath,
  onSelect,
  emptyText,
}: {
  groups: readonly Group[]
  selectedPath: string | undefined
  onSelect: (path: string) => void
  emptyText: string
}) {
  if (groups.length === 0) return <p className="muted">{emptyText}</p>
  return (
    <>
      {groups.map((group) => (
        <div key={group.name} className="token-group">
          <h3>{group.name}</h3>
          <ul className="token-items">
            {group.items.map((item) => (
              <li key={item.path}>
                <ItemButton
                  item={item}
                  selected={item.path === selectedPath}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

/**
 * The tokens of the draft: search, one tab per tier with counts, and the list of the
 * selected tier. Every tier's TabPanel stays mounted (so aria-controls always
 * resolves, ADR 0011) but only the selected one holds list content.
 */
export function TokenList({
  items,
  selectedPath,
  canCreate,
  headingRef,
  query,
  onQueryChange,
  onSelect,
  onCreate,
}: {
  items: readonly ListItem[]
  selectedPath: string | undefined
  canCreate: boolean
  headingRef: Ref<HTMLHeadingElement>
  query: string
  onQueryChange: (query: string) => void
  onSelect: (path: string) => void
  onCreate: () => void
}) {
  const selectedTier =
    selectedPath === undefined ? undefined : tierTabOf(selectedPath)
  const [tier, setTier] = useState<TierTab>(selectedTier ?? 'primitive')
  // Selecting a token in another tier (a link, the URL) opens that tier. This is
  // state adjusted while rendering, not an effect: it settles in the same pass.
  const [seenTier, setSeenTier] = useState(selectedTier)
  if (selectedTier !== seenTier) {
    setSeenTier(selectedTier)
    if (selectedTier !== undefined) setTier(selectedTier)
  }

  const filtered = useMemo(() => filterItems(items, query), [items, query])
  const groups = useMemo(() => groupByTier(filtered), [filtered])
  const hasOther = items.some((item) => tierTabOf(item.path) === 'other')
  const tabs: TierTab[] = hasOther
    ? ['primitive', 'semantic', 'component', 'other']
    : ['primitive', 'semantic', 'component']
  const count = (name: TierTab) =>
    groups[name].reduce((total, group) => total + group.items.length, 0)
  const searching = query.trim() !== ''

  return (
    <section aria-labelledby="tokens-heading" className="panel">
      <div className="panel__title">
        <h2 id="tokens-heading" tabIndex={-1} ref={headingRef}>
          Tokens
        </h2>
        {canCreate ? (
          <Button variant="secondary" size="sm" onClick={onCreate}>
            Create token
          </Button>
        ) : null}
      </div>
      <TextField
        label="Search tokens"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value)
        }}
      />
      <Tabs
        value={tier}
        onValueChange={(value) => {
          setTier(value as TierTab)
        }}
      >
        <TabList aria-label="Token tiers">
          {tabs.map((name) => (
            <Tab key={name} value={name}>
              {TIER_LABEL[name]} ({count(name)})
            </Tab>
          ))}
        </TabList>
        {tabs.map((name) => (
          <TabPanel key={name} value={name}>
            {name === tier ? (
              <Groups
                groups={groups[name]}
                selectedPath={selectedPath}
                onSelect={onSelect}
                emptyText={
                  searching
                    ? 'No tokens match your search.'
                    : 'There are no tokens in this tier.'
                }
              />
            ) : null}
          </TabPanel>
        ))}
      </Tabs>
    </section>
  )
}
