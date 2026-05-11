import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemText,
  AutocompleteLabel,
  AutocompleteList,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
  useAutocompleteFilter,
  useAutocompleteFilteredItems,
} from '.'
import { cn } from '../cn'

type Suggestion = {
  value: string
  label: string
  description?: string
  icon?: string
  meta?: string
}

type SuggestionGroup = {
  label: string
  items: Suggestion[]
}

const inputWidth = 'w-80'

type StoryVirtualizer = Virtualizer<HTMLDivElement, Element>

const scrollHighlightedVirtualItem = (
  item: unknown,
  {
    reason,
    index,
  }: {
    reason: 'keyboard' | 'pointer' | 'none'
    index: number
  },
  virtualizer: StoryVirtualizer | null,
) => {
  if (!item || !virtualizer)
    return

  const isStart = index === 0
  const isEnd = index === virtualizer.options.count - 1
  const shouldScroll = reason === 'none' || (reason === 'keyboard' && (isStart || isEnd))

  if (shouldScroll) {
    queueMicrotask(() => {
      virtualizer.scrollToIndex(index, { align: isEnd ? 'start' : 'end' })
    })
  }
}

const tagSuggestions: Suggestion[] = [
  { value: 'feature', label: 'feature', description: 'Product work and launch notes' },
  { value: 'fix', label: 'fix', description: 'Bug fixes and regressions' },
  { value: 'docs', label: 'docs', description: 'Documentation updates' },
  { value: 'internal', label: 'internal', description: 'Workspace-only notes' },
  { value: 'mobile', label: 'mobile', description: 'Mobile app issues' },
  { value: 'component: autocomplete', label: 'component: autocomplete', description: 'Base UI primitive wrapper' },
  { value: 'component: combobox', label: 'component: combobox', description: 'Filterable predefined selection' },
  { value: 'component: select', label: 'component: select', description: 'Compact predefined selection' },
]

const promptCompletions: Suggestion[] = [
  { value: 'summarize this conversation', label: 'summarize this conversation' },
  { value: 'summarize this dataset with citations', label: 'summarize this dataset with citations' },
  { value: 'summarize this workflow run for an operator', label: 'summarize this workflow run for an operator' },
  { value: 'summarize this support ticket in 3 bullets', label: 'summarize this support ticket in 3 bullets' },
]

const workflowSuggestions: Suggestion[] = [
  { value: 'http-request', label: 'HTTP Request', description: 'Call an external API', icon: 'i-ri-global-line', meta: 'Tool' },
  { value: 'knowledge-retrieval', label: 'Knowledge Retrieval', description: 'Search configured datasets', icon: 'i-ri-database-2-line', meta: 'Tool' },
  { value: 'code-execution', label: 'Code Execution', description: 'Run sandboxed snippets', icon: 'i-ri-code-s-slash-line', meta: 'Tool' },
  { value: 'template-transform', label: 'Template Transform', description: 'Compose variables into output', icon: 'i-ri-braces-line', meta: 'Tool' },
  { value: 'question-classifier', label: 'Question Classifier', description: 'Route by intent', icon: 'i-ri-git-branch-line', meta: 'Tool' },
  { value: 'parameter-extractor', label: 'Parameter Extractor', description: 'Extract typed values', icon: 'i-ri-list-check-3', meta: 'Tool' },
  { value: 'answer-node', label: 'Answer Node', description: 'Return a final assistant answer', icon: 'i-ri-message-3-line', meta: 'Node' },
  { value: 'iteration-node', label: 'Iteration Node', description: 'Run a loop over array items', icon: 'i-ri-repeat-line', meta: 'Node' },
  { value: 'variable-assigner', label: 'Variable Assigner', description: 'Persist intermediate state', icon: 'i-ri-pencil-ruler-2-line', meta: 'Node' },
]

const groupedSuggestions: SuggestionGroup[] = [
  {
    label: 'Tags',
    items: tagSuggestions.slice(0, 5),
  },
  {
    label: 'Workflow Suggestions',
    items: workflowSuggestions.slice(0, 5),
  },
  {
    label: 'Prompt Starters',
    items: promptCompletions.slice(0, 3),
  },
]

const commandGroups: SuggestionGroup[] = [
  {
    label: 'App',
    items: [
      { value: '/run', label: 'Run workflow', description: 'Execute the current draft', icon: 'i-ri-play-circle-line' },
      { value: '/publish', label: 'Publish app', description: 'Ship the current configuration', icon: 'i-ri-upload-cloud-2-line' },
      { value: '/trace', label: 'Open trace', description: 'Inspect the latest workflow run', icon: 'i-ri-route-line' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { value: '/dataset', label: 'Search datasets', description: 'Find knowledge attached to this app', icon: 'i-ri-database-line' },
      { value: '/members', label: 'Invite members', description: 'Open workspace access settings', icon: 'i-ri-user-add-line' },
      { value: '/usage', label: 'View usage', description: 'Open model and workflow usage', icon: 'i-ri-bar-chart-line' },
    ],
  },
]

const remoteSuggestions: Suggestion[] = [
  { value: 'agent-builder', label: 'Agent Builder', description: 'Workspace app' },
  { value: 'agent-observability', label: 'Agent Observability', description: 'Dataset' },
  { value: 'agent-routing-dataset', label: 'Agent Routing Dataset', description: 'Knowledge source' },
]

const virtualizedSuggestions: Suggestion[] = Array.from({ length: 1000 }, (_, index) => {
  const family = ['workflow', 'dataset', 'prompt', 'tool'][index % 4]!
  const number = new Intl.NumberFormat('en-US', {
    minimumIntegerDigits: 4,
  }).format(index + 1)

  return {
    value: `${family}-${index + 1}`,
    label: `${family} suggestion ${number}`,
    description: `Free-form autocomplete result from ${family} search`,
    icon: family === 'dataset'
      ? 'i-ri-database-2-line'
      : family === 'prompt'
        ? 'i-ri-text-snippet'
        : family === 'tool'
          ? 'i-ri-tools-line'
          : 'i-ri-flow-chart',
    meta: family,
  }
})

const getSuggestionLabel = (item: Suggestion) => item.label

const SuggestionItem = ({
  item,
  index,
  dense,
}: {
  item: Suggestion
  index?: number
  dense?: boolean
}) => (
  <AutocompleteItem value={item} index={index}>
    {item.icon && <span className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')} aria-hidden="true" />}
    <div className="flex min-w-0 grow flex-col">
      <AutocompleteItemText className="px-0">{item.label}</AutocompleteItemText>
      {!dense && item.description && (
        <span className="truncate system-xs-regular text-text-tertiary">{item.description}</span>
      )}
    </div>
    {item.meta && (
      <span className="shrink-0 rounded-md bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
        {item.meta}
      </span>
    )}
  </AutocompleteItem>
)

const TagSuggestionItem = ({
  item,
  index,
}: {
  item: Suggestion
  index?: number
}) => (
  <AutocompleteItem value={item} index={index}>
    <AutocompleteItemText className="px-0">{item.label}</AutocompleteItemText>
    {item.description && <span className="ml-auto max-w-36 truncate system-xs-regular text-text-tertiary">{item.description}</span>}
  </AutocompleteItem>
)

const BasicTagAutocomplete = ({
  size = 'medium',
}: {
  size?: 'small' | 'medium' | 'large'
}) => (
  <Autocomplete
    items={tagSuggestions}
    itemToStringValue={getSuggestionLabel}
    openOnInputClick
  >
    <AutocompleteInputGroup size={size}>
      <span className="i-ri-search-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
      <AutocompleteInput size={size} placeholder="Search tags or type a new one…" aria-label="Search tags or type a new one" />
      <AutocompleteClear size={size} />
      <AutocompleteTrigger size={size} />
    </AutocompleteInputGroup>
    <AutocompleteContent>
      <AutocompleteList>
        {(item: Suggestion, index: number) => (
          <TagSuggestionItem key={item.value} item={item} index={index} />
        )}
      </AutocompleteList>
      <AutocompleteEmpty>No tag suggestion. Keep the typed value.</AutocompleteEmpty>
    </AutocompleteContent>
  </Autocomplete>
)

const GroupedSuggestionList = () => {
  const groups = useAutocompleteFilteredItems<SuggestionGroup>()

  return (
    <AutocompleteList>
      {groups.map((group, groupIndex) => (
        <AutocompleteGroup key={group.label} items={group.items}>
          {groupIndex > 0 && <AutocompleteSeparator />}
          <AutocompleteLabel>{group.label}</AutocompleteLabel>
          <AutocompleteCollection>
            {(item: Suggestion) => (
              <SuggestionItem key={item.value} item={item} />
            )}
          </AutocompleteCollection>
        </AutocompleteGroup>
      ))}
    </AutocompleteList>
  )
}

const CommandPaletteList = () => {
  const groups = useAutocompleteFilteredItems<SuggestionGroup>()

  return (
    <AutocompleteList className="max-h-72 rounded-lg border border-divider-subtle bg-components-panel-bg p-1 shadow-xs">
      {groups.map((group, groupIndex) => (
        <AutocompleteGroup key={group.label} items={group.items}>
          {groupIndex > 0 && <AutocompleteSeparator />}
          <AutocompleteLabel>{group.label}</AutocompleteLabel>
          <AutocompleteCollection>
            {(item: Suggestion) => (
              <AutocompleteItem key={item.value} value={item} className="grid grid-cols-[1fr_auto]">
                <span className="flex min-w-0 items-center gap-2">
                  {item.icon && <span className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')} aria-hidden="true" />}
                  <span className="min-w-0">
                    <AutocompleteItemText className="block px-0">{item.label}</AutocompleteItemText>
                    <span className="block truncate system-xs-regular text-text-tertiary">{item.description}</span>
                  </span>
                </span>
                <kbd className="rounded-md border border-divider-subtle bg-components-badge-bg-dimm px-1.5 py-0.5 text-text-quaternary system-2xs-medium">
                  Enter
                </kbd>
              </AutocompleteItem>
            )}
          </AutocompleteCollection>
        </AutocompleteGroup>
      ))}
    </AutocompleteList>
  )
}

const LimitedStatus = ({
  total,
}: {
  total: number
}) => {
  const items = useAutocompleteFilteredItems<Suggestion>()
  const hidden = Math.max(0, total - items.length)

  return hidden > 0
    ? `${hidden} more suggestions hidden. Refine the query to narrow results.`
    : `${items.length} suggestions available.`
}

const AsyncSearchDemo = () => {
  const [value, setValue] = useState('agent')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState(remoteSuggestions)

  useEffect(() => {
    setLoading(true)
    const timeout = window.setTimeout(() => {
      setItems(
        value.trim()
          ? remoteSuggestions.filter(item => item.label.toLowerCase().includes(value.trim().toLowerCase()))
          : remoteSuggestions,
      )
      setLoading(false)
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [value])

  return (
    <div className={inputWidth}>
      <Autocomplete
        items={items}
        value={value}
        onValueChange={setValue}
        itemToStringValue={getSuggestionLabel}
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span className="i-ri-cloud-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Search remote resources…" aria-label="Search remote resources" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteStatus>
            {loading ? 'Loading suggestions…' : `${items.length} remote suggestions`}
          </AutocompleteStatus>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <SuggestionItem key={item.value} item={item} index={index} />
            )}
          </AutocompleteList>
          <AutocompleteEmpty>No remote suggestion. Keep the typed query.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  )
}

const VirtualizedSuggestionList = ({
  virtualizerRef,
}: {
  virtualizerRef: RefObject<StoryVirtualizer | null>
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const filteredItems = useAutocompleteFilteredItems<Suggestion>()
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 6,
  })

  useEffect(() => {
    virtualizerRef.current = virtualizer

    return () => {
      virtualizerRef.current = null
    }
  }, [virtualizer, virtualizerRef])

  return (
    <div
      ref={scrollRef}
      className="max-h-[min(22rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain outline-hidden"
    >
      <AutocompleteList
        className="relative max-h-none overflow-visible p-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = filteredItems[virtualItem.index]

          if (!item)
            return null

          return (
            <div
              key={virtualItem.key}
              className="absolute top-0 left-0 w-full"
              style={{
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SuggestionItem item={item} index={virtualItem.index} />
            </div>
          )
        })}
      </AutocompleteList>
    </div>
  )
}

const VirtualizedStatus = () => {
  const filteredItems = useAutocompleteFilteredItems<Suggestion>()

  return (
    <AutocompleteStatus className="border-b border-divider-subtle text-text-quaternary tabular-nums">
      {filteredItems.length}
      {' '}
      matching suggestions. Selecting one only replaces the input text.
    </AutocompleteStatus>
  )
}

const FuzzyHighlight = ({
  text,
  query,
}: {
  text: string
  query: string
}) => {
  const parts = useMemo(() => {
    const trimmed = query.trim()

    if (!trimmed)
      return [text]

    const escaped = trimmed.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.split(new RegExp(`(${escaped})`, 'i'))
  }, [query, text])

  return (
    <>
      {parts.map((part, index) => (
        part.toLowerCase() === query.trim().toLowerCase()
          ? <mark key={`${part}-${index}`} className="bg-transparent text-text-accent">{part}</mark>
          : part
      ))}
    </>
  )
}

const FuzzyMatchingDemo = () => {
  const [value, setValue] = useState('retr')
  const { contains } = useAutocompleteFilter({ sensitivity: 'base' })

  return (
    <div className={inputWidth}>
      <Autocomplete
        items={workflowSuggestions}
        value={value}
        onValueChange={setValue}
        filter={contains}
        itemToStringValue={getSuggestionLabel}
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span className="i-ri-sparkling-2-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Fuzzy search workflow suggestions…" aria-label="Fuzzy search workflow suggestions" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <AutocompleteItem key={item.value} value={item} index={index}>
                {item.icon && <span className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')} aria-hidden="true" />}
                <div className="min-w-0 grow">
                  <AutocompleteItemText className="block px-0">
                    <FuzzyHighlight text={item.label} query={value} />
                  </AutocompleteItemText>
                  <span className="block truncate system-xs-regular text-text-tertiary">{item.description}</span>
                </div>
              </AutocompleteItem>
            )}
          </AutocompleteList>
          <AutocompleteEmpty>No workflow suggestion. Keep typing freely.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  )
}

const meta = {
  title: 'Base/UI/Autocomplete',
  component: Autocomplete,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound autocomplete built on Base UI Autocomplete. Use it for free-form inputs where suggestions can replace or complete the typed text, but selection is not persistent state.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Autocomplete>

export default meta
type Story = StoryObj<typeof meta>

export const SearchTags: Story = {
  render: () => (
    <div className={inputWidth}>
      <BasicTagAutocomplete />
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['small', 'medium', 'large'] as const).map(size => (
        <div key={size} className={inputWidth}>
          <BasicTagAutocomplete size={size} />
        </div>
      ))}
    </div>
  ),
}

export const InlineAutocomplete: Story = {
  render: () => (
    <div className={inputWidth}>
      <Autocomplete
        items={promptCompletions}
        itemToStringValue={getSuggestionLabel}
        mode="both"
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span className="i-ri-text-snippet ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Type a prompt starter…" aria-label="Type a prompt starter" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <SuggestionItem key={item.value} item={item} index={index} dense />
            )}
          </AutocompleteList>
          <AutocompleteEmpty>No inline completion. Continue typing freely.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  ),
}

export const GroupedSuggestions: Story = {
  render: () => (
    <div className={inputWidth}>
      <Autocomplete
        items={groupedSuggestions}
        itemToStringValue={getSuggestionLabel}
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span className="i-ri-command-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Search tags, nodes, or prompt starters…" aria-label="Search tags, nodes, or prompt starters" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent popupClassName="w-[420px]">
          <GroupedSuggestionList />
          <AutocompleteEmpty>No suggestion. Use the text as entered.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  ),
}

export const FuzzyMatching: Story = {
  render: () => <FuzzyMatchingDemo />,
}

export const LimitResults: Story = {
  render: () => (
    <div className={inputWidth}>
      <Autocomplete
        items={workflowSuggestions}
        itemToStringValue={getSuggestionLabel}
        limit={5}
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span className="i-ri-tools-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Search workflow suggestions…" aria-label="Search workflow suggestions" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent popupClassName="w-[420px]">
          <AutocompleteStatus className="border-b border-divider-subtle">
            <LimitedStatus total={workflowSuggestions.length} />
          </AutocompleteStatus>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <SuggestionItem key={item.value} item={item} index={index} />
            )}
          </AutocompleteList>
          <AutocompleteEmpty>No suggestion. Submit the typed text instead.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  ),
}

export const CommandPalette: Story = {
  render: () => (
    <div className="w-[440px] rounded-xl border border-divider-subtle bg-components-panel-bg-alt p-2 shadow-xs">
      <Autocomplete
        open
        inline
        items={commandGroups}
        itemToStringValue={getSuggestionLabel}
        autoHighlight="always"
        keepHighlight
      >
        <AutocompleteInputGroup className="mb-2">
          <span className="i-ri-search-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Run a command…" aria-label="Run a command" />
          <AutocompleteClear />
        </AutocompleteInputGroup>
        <CommandPaletteList />
      </Autocomplete>
    </div>
  ),
}

const VirtualizedLongSuggestionsDemo = () => {
  const virtualizerRef = useRef<StoryVirtualizer | null>(null)

  return (
    <div className={inputWidth}>
      <Autocomplete
        items={virtualizedSuggestions}
        itemToStringValue={getSuggestionLabel}
        virtualized
        openOnInputClick
        onItemHighlighted={(item, details) => {
          scrollHighlightedVirtualItem(item, details, virtualizerRef.current)
        }}
      >
        <AutocompleteInputGroup>
          <span className="i-ri-search-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Search 1,000 workspace suggestions…" aria-label="Search 1,000 workspace suggestions" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent popupClassName="w-[440px] p-1">
          <VirtualizedStatus />
          <VirtualizedSuggestionList virtualizerRef={virtualizerRef} />
          <AutocompleteEmpty>No suggestion. Free-form text is still valid.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  )
}

export const VirtualizedLongSuggestions: Story = {
  render: () => <VirtualizedLongSuggestionsDemo />,
}

export const AsyncSearch: Story = {
  render: () => <AsyncSearchDemo />,
}

export const Empty: Story = {
  render: () => (
    <div className={inputWidth}>
      <Autocomplete
        items={tagSuggestions}
        itemToStringValue={getSuggestionLabel}
        defaultValue="private-release-note"
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span className="i-ri-search-line ml-2 size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <AutocompleteInput placeholder="Search tags or type a new one…" aria-label="Search tags or type a new one" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <TagSuggestionItem key={item.value} item={item} index={index} />
            )}
          </AutocompleteList>
          <AutocompleteEmpty>No tag suggestion. The custom text remains valid.</AutocompleteEmpty>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  ),
}

export const DisabledAndReadOnly: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Autocomplete items={tagSuggestions} itemToStringValue={getSuggestionLabel} defaultValue="feature" disabled>
        <AutocompleteInputGroup>
          <AutocompleteInput aria-label="Disabled tag autocomplete" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <TagSuggestionItem key={item.value} item={item} index={index} />
            )}
          </AutocompleteList>
        </AutocompleteContent>
      </Autocomplete>
      <Autocomplete items={promptCompletions} itemToStringValue={getSuggestionLabel} defaultValue="summarize this conversation" readOnly>
        <AutocompleteInputGroup>
          <AutocompleteInput aria-label="Read-only prompt autocomplete" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompleteContent>
          <AutocompleteList>
            {(item: Suggestion, index: number) => (
              <SuggestionItem key={item.value} item={item} index={index} />
            )}
          </AutocompleteList>
        </AutocompleteContent>
      </Autocomplete>
    </div>
  ),
}
