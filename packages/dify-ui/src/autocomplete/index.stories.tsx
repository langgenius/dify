import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Virtualizer } from '@tanstack/react-virtual'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as React from 'react'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemText,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  AutocompleteRow,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
  useAutocompleteFilter,
  useAutocompleteFilteredItems,
} from '.'
import { cn } from '../cn'
import { Kbd } from '../kbd'

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
  if (!item || !virtualizer) return

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
  {
    value: 'component: autocomplete',
    label: 'component: autocomplete',
    description: 'Base UI primitive wrapper',
  },
  {
    value: 'component: combobox',
    label: 'component: combobox',
    description: 'Filterable predefined selection',
  },
  {
    value: 'component: select',
    label: 'component: select',
    description: 'Compact predefined selection',
  },
]

const promptCompletions: Suggestion[] = [
  { value: 'summarize this conversation', label: 'summarize this conversation' },
  {
    value: 'summarize this dataset with citations',
    label: 'summarize this dataset with citations',
  },
  {
    value: 'summarize this workflow run for an operator',
    label: 'summarize this workflow run for an operator',
  },
  {
    value: 'summarize this support ticket in 3 bullets',
    label: 'summarize this support ticket in 3 bullets',
  },
]

const workflowSuggestions: Suggestion[] = [
  {
    value: 'http-request',
    label: 'HTTP Request',
    description: 'Call an external API',
    icon: 'i-ri-global-line',
    meta: 'Tool',
  },
  {
    value: 'knowledge-retrieval',
    label: 'Knowledge Retrieval',
    description: 'Search configured datasets',
    icon: 'i-ri-database-2-line',
    meta: 'Tool',
  },
  {
    value: 'code-execution',
    label: 'Code Execution',
    description: 'Run sandboxed snippets',
    icon: 'i-ri-code-s-slash-line',
    meta: 'Tool',
  },
  {
    value: 'template-transform',
    label: 'Template Transform',
    description: 'Compose variables into output',
    icon: 'i-ri-braces-line',
    meta: 'Tool',
  },
  {
    value: 'question-classifier',
    label: 'Question Classifier',
    description: 'Route by intent',
    icon: 'i-ri-git-branch-line',
    meta: 'Tool',
  },
  {
    value: 'parameter-extractor',
    label: 'Parameter Extractor',
    description: 'Extract typed values',
    icon: 'i-ri-list-check-3',
    meta: 'Tool',
  },
  {
    value: 'answer-node',
    label: 'Answer Node',
    description: 'Return a final assistant answer',
    icon: 'i-ri-message-3-line',
    meta: 'Node',
  },
  {
    value: 'iteration-node',
    label: 'Iteration Node',
    description: 'Run a loop over array items',
    icon: 'i-ri-repeat-line',
    meta: 'Node',
  },
  {
    value: 'variable-assigner',
    label: 'Variable Assigner',
    description: 'Persist intermediate state',
    icon: 'i-ri-pencil-ruler-2-line',
    meta: 'Node',
  },
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
      {
        value: '/run',
        label: 'Run workflow',
        description: 'Execute the current draft',
        icon: 'i-ri-play-circle-line',
      },
      {
        value: '/publish',
        label: 'Publish app',
        description: 'Ship the current configuration',
        icon: 'i-ri-upload-cloud-2-line',
      },
      {
        value: '/trace',
        label: 'Open trace',
        description: 'Inspect the latest workflow run',
        icon: 'i-ri-route-line',
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        value: '/dataset',
        label: 'Search datasets',
        description: 'Find knowledge attached to this app',
        icon: 'i-ri-database-line',
      },
      {
        value: '/members',
        label: 'Invite members',
        description: 'Open workspace access settings',
        icon: 'i-ri-user-add-line',
      },
      {
        value: '/usage',
        label: 'View usage',
        description: 'Open model and workflow usage',
        icon: 'i-ri-bar-chart-line',
      },
    ],
  },
]

const remoteSuggestions: Suggestion[] = [
  { value: 'agent-builder', label: 'Agent Builder', description: 'Workspace app' },
  { value: 'agent-observability', label: 'Agent Observability', description: 'Dataset' },
  {
    value: 'agent-routing-dataset',
    label: 'Agent Routing Dataset',
    description: 'Knowledge source',
  },
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
    icon:
      family === 'dataset'
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

async function searchSuggestions(
  suggestions: Suggestion[],
  query: string,
  filter: (item: string, query: string) => boolean,
): Promise<{ items: Suggestion[]; error: string | null }> {
  await new Promise((resolve) => window.setTimeout(resolve, 500))

  if (query === 'will_error') {
    return {
      items: [],
      error: 'Failed to load suggestions. Please try again.',
    }
  }

  return {
    items: suggestions.filter(
      (item) =>
        filter(item.label, query) || (item.description ? filter(item.description, query) : false),
    ),
    error: null,
  }
}

function SuggestionItem({ item, dense }: { item: Suggestion; dense?: boolean }) {
  return (
    <AutocompleteItem value={item}>
      {item.icon && (
        <span className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')} aria-hidden="true" />
      )}
      <div className="flex min-w-0 grow flex-col">
        <AutocompleteItemText>{item.label}</AutocompleteItemText>
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
}

// Only virtualized items receive an explicit index; ordinary lists must let Base UI register items by DOM order for keyboard navigation.
function VirtualizedSuggestionItem({
  item,
  index,
  dense,
}: {
  item: Suggestion
  index: number
  dense?: boolean
}) {
  return (
    <AutocompleteItem value={item} index={index}>
      {item.icon && (
        <span className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')} aria-hidden="true" />
      )}
      <div className="flex min-w-0 grow flex-col">
        <AutocompleteItemText>{item.label}</AutocompleteItemText>
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
}

function TagSuggestionItem({ item }: { item: Suggestion }) {
  return (
    <AutocompleteItem value={item}>
      <AutocompleteItemText>{item.label}</AutocompleteItemText>
      {item.description && (
        <span className="ml-auto max-w-36 truncate system-xs-regular text-text-tertiary">
          {item.description}
        </span>
      )}
    </AutocompleteItem>
  )
}

function BasicTagAutocomplete({ size = 'medium' }: { size?: 'small' | 'medium' | 'large' }) {
  return (
    <Autocomplete
      items={tagSuggestions}
      itemToStringValue={getSuggestionLabel}
      mode="list"
      openOnInputClick
    >
      <AutocompleteInputGroup size={size}>
        <span
          className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
          aria-hidden="true"
        />
        <AutocompleteInput
          size={size}
          placeholder="Search tags or type a new one…"
          aria-label="Search tags or type a new one"
        />
        <AutocompleteClear size={size} />
        <AutocompleteTrigger size={size} />
      </AutocompleteInputGroup>
      <AutocompletePortal>
        <AutocompletePositioner>
          <AutocompletePopup>
            <AutocompleteList<Suggestion>>
              {(item) => <TagSuggestionItem key={item.value} item={item} />}
            </AutocompleteList>
            <AutocompleteEmpty>No tag suggestion. Keep the typed value.</AutocompleteEmpty>
          </AutocompletePopup>
        </AutocompletePositioner>
      </AutocompletePortal>
    </Autocomplete>
  )
}

type IconOption = {
  value: string
  label: string
  icon: string
}

const iconOptions: IconOption[] = [
  { value: 'home', label: 'Home', icon: 'i-ri-home-line' },
  { value: 'search', label: 'Search', icon: 'i-ri-search-line' },
  { value: 'settings', label: 'Settings', icon: 'i-ri-settings-3-line' },
  { value: 'user', label: 'User', icon: 'i-ri-user-line' },
  { value: 'folder', label: 'Folder', icon: 'i-ri-folder-line' },
  { value: 'document', label: 'Document', icon: 'i-ri-file-text-line' },
  { value: 'image', label: 'Image', icon: 'i-ri-image-line' },
  { value: 'calendar', label: 'Calendar', icon: 'i-ri-calendar-line' },
  { value: 'clock', label: 'Clock', icon: 'i-ri-time-line' },
  { value: 'mail', label: 'Mail', icon: 'i-ri-mail-line' },
  { value: 'chat', label: 'Chat', icon: 'i-ri-chat-3-line' },
  { value: 'notification', label: 'Notification', icon: 'i-ri-notification-3-line' },
  { value: 'star', label: 'Star', icon: 'i-ri-star-line' },
  { value: 'heart', label: 'Heart', icon: 'i-ri-heart-line' },
  { value: 'bookmark', label: 'Bookmark', icon: 'i-ri-bookmark-line' },
  { value: 'lock', label: 'Lock', icon: 'i-ri-lock-line' },
  { value: 'key', label: 'Key', icon: 'i-ri-key-2-line' },
  { value: 'link', label: 'Link', icon: 'i-ri-link' },
  { value: 'attachment', label: 'Attachment', icon: 'i-ri-attachment-2' },
  { value: 'download', label: 'Download', icon: 'i-ri-download-line' },
  { value: 'upload', label: 'Upload', icon: 'i-ri-upload-line' },
  { value: 'share', label: 'Share', icon: 'i-ri-share-line' },
  { value: 'edit', label: 'Edit', icon: 'i-ri-edit-line' },
  { value: 'delete', label: 'Delete', icon: 'i-ri-delete-bin-line' },
  { value: 'code', label: 'Code', icon: 'i-ri-code-line' },
  { value: 'terminal', label: 'Terminal', icon: 'i-ri-terminal-box-line' },
  { value: 'database', label: 'Database', icon: 'i-ri-database-2-line' },
  { value: 'cloud', label: 'Cloud', icon: 'i-ri-cloud-line' },
  { value: 'globe', label: 'Globe', icon: 'i-ri-global-line' },
  { value: 'location', label: 'Location', icon: 'i-ri-map-pin-line' },
  { value: 'lightning', label: 'Lightning', icon: 'i-ri-flashlight-line' },
  { value: 'robot', label: 'Robot', icon: 'i-ri-robot-2-line' },
]

const iconGridColumns = 8

const getIconLabel = (item: IconOption) => item.label

function IconGridList({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (value: string) => void
}) {
  const items = useAutocompleteFilteredItems<IconOption>()
  const rows = Array.from({ length: Math.ceil(items.length / iconGridColumns) }, (_, rowIndex) =>
    items.slice(rowIndex * iconGridColumns, (rowIndex + 1) * iconGridColumns),
  )

  return (
    <AutocompleteList aria-label="Icons" className="flex max-h-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <AutocompleteRow key={row[0]?.value} className="grid grid-cols-8 gap-1">
          {row.map((item) => (
            <AutocompleteItem
              key={item.value}
              value={item}
              aria-label={item.label}
              onClick={() => onSelect(item.value)}
              className={cn(
                'size-8 min-h-0 justify-center p-0',
                selected === item.value &&
                  'ring-[1.5px] ring-components-option-card-option-selected-border ring-inset',
              )}
            >
              <span className={cn(item.icon, 'size-4 text-text-secondary')} aria-hidden="true" />
            </AutocompleteItem>
          ))}
        </AutocompleteRow>
      ))}
    </AutocompleteList>
  )
}

function IconGridDemo() {
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState('home')

  return (
    <div className="w-80 rounded-xl border border-divider-subtle bg-components-panel-bg p-3 shadow-xs">
      <Autocomplete
        open
        inline
        grid
        autoHighlight
        items={iconOptions}
        itemToStringValue={getIconLabel}
        value={search}
        onValueChange={(next, details) => {
          // Pressing an icon picks it; the query stays so the grid does not collapse to one match.
          if (details.reason !== 'item-press') setSearch(next)
        }}
      >
        <AutocompleteInputGroup className="mb-3">
          <span
            className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Search icons…"
            aria-label="Search icons"
            aria-expanded="true"
          />
          <AutocompleteClear />
        </AutocompleteInputGroup>
        <IconGridList selected={selected} onSelect={setSelected} />
        <AutocompleteEmpty className="p-0 text-text-tertiary">No icon matches.</AutocompleteEmpty>
      </Autocomplete>
    </div>
  )
}

function GroupedSuggestionList() {
  const groups = useAutocompleteFilteredItems<SuggestionGroup>()

  return (
    <AutocompleteList>
      {groups.map((group, groupIndex) => (
        <AutocompleteGroup key={group.label} items={group.items}>
          {groupIndex > 0 && <AutocompleteSeparator />}
          <AutocompleteGroupLabel>{group.label}</AutocompleteGroupLabel>
          <AutocompleteCollection<Suggestion>>
            {(item) => <SuggestionItem key={item.value} item={item} />}
          </AutocompleteCollection>
        </AutocompleteGroup>
      ))}
    </AutocompleteList>
  )
}

function CommandPaletteList() {
  const groups = useAutocompleteFilteredItems<SuggestionGroup>()

  return (
    <AutocompleteList className="max-h-72 rounded-lg border border-divider-subtle bg-components-panel-bg p-1 shadow-xs">
      {groups.map((group, groupIndex) => (
        <AutocompleteGroup key={group.label} items={group.items}>
          {groupIndex > 0 && <AutocompleteSeparator />}
          <AutocompleteGroupLabel>{group.label}</AutocompleteGroupLabel>
          <AutocompleteCollection<Suggestion>>
            {(item) => (
              <AutocompleteItem key={item.value} value={item} className="grid grid-cols-[1fr_auto]">
                <span className="flex min-w-0 items-center gap-2">
                  {item.icon && (
                    <span
                      className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0">
                    <AutocompleteItemText className="block">{item.label}</AutocompleteItemText>
                    <span className="block truncate system-xs-regular text-text-tertiary">
                      {item.description}
                    </span>
                  </span>
                </span>
                <Kbd className="text-text-quaternary">Enter</Kbd>
              </AutocompleteItem>
            )}
          </AutocompleteCollection>
        </AutocompleteGroup>
      ))}
    </AutocompleteList>
  )
}

const LimitedStatus = ({ total }: { total: number }) => {
  const items = useAutocompleteFilteredItems<Suggestion>()
  const hidden = Math.max(0, total - items.length)

  return hidden > 0
    ? `${hidden} more suggestions hidden. Refine the query to narrow results.`
    : `${items.length} suggestions available.`
}

function AsyncSearchDemo() {
  const [searchValue, setSearchValue] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<Suggestion[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const { contains } = useAutocompleteFilter()
  const abortControllerRef = React.useRef<AbortController | null>(null)

  const status = (() => {
    if (isPending) return 'Searching remote suggestions…'

    if (error) return error

    if (searchValue === '') return null

    if (searchResults.length === 0) return `No remote suggestion matches "${searchValue}".`

    return `${searchResults.length} remote suggestion${searchResults.length === 1 ? '' : 's'} found`
  })()

  return (
    <div className={inputWidth}>
      <Autocomplete
        items={searchResults}
        value={searchValue}
        onValueChange={(nextSearchValue) => {
          setSearchValue(nextSearchValue)

          const controller = new AbortController()
          abortControllerRef.current?.abort()
          abortControllerRef.current = controller

          if (nextSearchValue === '') {
            setSearchResults([])
            setError(null)
            return
          }

          startTransition(async () => {
            setError(null)

            const result = await searchSuggestions(remoteSuggestions, nextSearchValue, contains)

            if (controller.signal.aborted) return

            startTransition(() => {
              setSearchResults(result.items)
              setError(result.error)
            })
          })
        }}
        itemToStringValue={getSuggestionLabel}
        filter={null}
        mode="list"
      >
        <AutocompleteInputGroup>
          <span
            className="i-ri-cloud-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Search remote resources…"
            aria-label="Search remote resources"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal hidden={!status}>
          <AutocompletePositioner>
            <AutocompletePopup aria-busy={isPending || undefined}>
              <AutocompleteStatus>{status}</AutocompleteStatus>
              <AutocompleteList<Suggestion>>
                {(item) => <SuggestionItem key={item.value} item={item} />}
              </AutocompleteList>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
    </div>
  )
}

function VirtualizedSuggestionList({
  virtualizerRef,
}: {
  virtualizerRef: React.RefObject<StoryVirtualizer | null>
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const filteredItems = useAutocompleteFilteredItems<Suggestion>()
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 6,
  })

  React.useEffect(() => {
    virtualizerRef.current = virtualizer

    return () => {
      virtualizerRef.current = null
    }
  }, [virtualizer, virtualizerRef])

  return (
    <div
      ref={scrollRef}
      className="max-h-[min(22rem,var(--available-height))] overflow-x-hidden overflow-y-auto overscroll-contain p-1 outline-hidden"
    >
      <AutocompleteList
        className="relative max-h-none overflow-visible p-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = filteredItems[virtualItem.index]

          if (!item) return null

          return (
            <div
              key={virtualItem.key}
              className="absolute top-0 left-0 w-full"
              style={{
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <VirtualizedSuggestionItem item={item} index={virtualItem.index} />
            </div>
          )
        })}
      </AutocompleteList>
    </div>
  )
}

function VirtualizedStatus() {
  const filteredItems = useAutocompleteFilteredItems<Suggestion>()

  return (
    <AutocompleteStatus>
      {filteredItems.length} matching suggestions. Selecting one only replaces the input text.
    </AutocompleteStatus>
  )
}

function FuzzyHighlight({ text, query }: { text: string; query: string }) {
  const parts = React.useMemo(() => {
    const trimmed = query.trim()

    if (!trimmed) return [text]

    const escaped = trimmed.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.split(new RegExp(`(${escaped})`, 'i'))
  }, [query, text])

  return (
    <React.Fragment>
      {parts.map((part, index) =>
        part.toLowerCase() === query.trim().toLowerCase() ? (
          // oxlint-disable-next-line react/no-array-index-key -- Repeated text fragments have no stable identity and never preserve state.
          <mark key={`${part}-${index}`} className="bg-transparent text-text-accent">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </React.Fragment>
  )
}

function FuzzyMatchingDemo() {
  const [value, setValue] = React.useState('retr')
  const { contains } = useAutocompleteFilter({ sensitivity: 'base' })

  return (
    <div className={inputWidth}>
      <Autocomplete
        items={workflowSuggestions}
        value={value}
        onValueChange={setValue}
        filter={contains}
        itemToStringValue={getSuggestionLabel}
        mode="list"
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span
            className="i-ri-sparkling-2-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Fuzzy search workflow suggestions…"
            aria-label="Fuzzy search workflow suggestions"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <AutocompleteList<Suggestion>>
                {(item) => (
                  <AutocompleteItem key={item.value} value={item}>
                    {item.icon && (
                      <span
                        className={cn(item.icon, 'size-4 shrink-0 text-text-tertiary')}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 grow">
                      <AutocompleteItemText className="block">
                        <FuzzyHighlight text={item.label} query={value} />
                      </AutocompleteItemText>
                      <span className="block truncate system-xs-regular text-text-tertiary">
                        {item.description}
                      </span>
                    </div>
                  </AutocompleteItem>
                )}
              </AutocompleteList>
              <AutocompleteEmpty>No workflow suggestion. Keep typing freely.</AutocompleteEmpty>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
    </div>
  )
}

const meta = {
  title: 'Base/Form/Autocomplete',
  component: Autocomplete,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound autocomplete built on Base UI Autocomplete. Use it for free-form inputs where suggestions can replace or complete the typed text, but selection is not persistent state.',
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
      {(['small', 'medium', 'large'] as const).map((size) => (
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
          <span
            className="i-ri-text-snippet size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Type a prompt starter…"
            aria-label="Type a prompt starter"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <AutocompleteList<Suggestion>>
                {(item) => <SuggestionItem key={item.value} item={item} dense />}
              </AutocompleteList>
              <AutocompleteEmpty>No inline completion. Continue typing freely.</AutocompleteEmpty>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
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
        mode="list"
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span
            className="i-ri-command-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Search tags, nodes, or prompt starters…"
            aria-label="Search tags, nodes, or prompt starters"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <GroupedSuggestionList />
              <AutocompleteEmpty>No suggestion. Use the text as entered.</AutocompleteEmpty>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
    </div>
  ),
}

export const IconGrid: Story = {
  render: () => <IconGridDemo />,
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
        mode="list"
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span
            className="i-ri-tools-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Search workflow suggestions…"
            aria-label="Search workflow suggestions"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <AutocompleteStatus>
                <LimitedStatus total={workflowSuggestions.length} />
              </AutocompleteStatus>
              <AutocompleteList<Suggestion>>
                {(item) => <SuggestionItem key={item.value} item={item} />}
              </AutocompleteList>
              <AutocompleteEmpty>No suggestion. Submit the typed text instead.</AutocompleteEmpty>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
    </div>
  ),
}

export const CommandPalette: Story = {
  render: () => (
    <div className="w-110 rounded-xl border border-divider-subtle bg-components-panel-bg-alt p-2 shadow-xs">
      <Autocomplete
        open
        inline
        items={commandGroups}
        itemToStringValue={getSuggestionLabel}
        mode="list"
        autoHighlight="always"
        keepHighlight
      >
        <AutocompleteInputGroup className="mb-2">
          <span
            className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Run a command…"
            aria-label="Run a command"
            aria-expanded="true"
          />
          <AutocompleteClear />
        </AutocompleteInputGroup>
        <CommandPaletteList />
      </Autocomplete>
    </div>
  ),
}

function VirtualizedLongSuggestionsDemo() {
  const virtualizerRef = React.useRef<StoryVirtualizer | null>(null)

  return (
    <div className={inputWidth}>
      <Autocomplete
        items={virtualizedSuggestions}
        itemToStringValue={getSuggestionLabel}
        mode="list"
        virtualized
        openOnInputClick
        onItemHighlighted={(item, details) => {
          scrollHighlightedVirtualItem(item, details, virtualizerRef.current)
        }}
      >
        <AutocompleteInputGroup>
          <span
            className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Search 1,000 workspace suggestions…"
            aria-label="Search 1,000 workspace suggestions"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <VirtualizedStatus />
              <VirtualizedSuggestionList virtualizerRef={virtualizerRef} />
              <AutocompleteEmpty>No suggestion. Free-form text is still valid.</AutocompleteEmpty>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
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
        mode="list"
        openOnInputClick
      >
        <AutocompleteInputGroup>
          <span
            className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
            aria-hidden="true"
          />
          <AutocompleteInput
            placeholder="Search tags or type a new one…"
            aria-label="Search tags or type a new one"
          />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <AutocompleteList<Suggestion>>
                {(item) => <TagSuggestionItem key={item.value} item={item} />}
              </AutocompleteList>
              <AutocompleteEmpty>
                No tag suggestion. The custom text remains valid.
              </AutocompleteEmpty>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
    </div>
  ),
}

export const DisabledAndReadOnly: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Autocomplete
        items={tagSuggestions}
        itemToStringValue={getSuggestionLabel}
        defaultValue="feature"
        mode="list"
        disabled
      >
        <AutocompleteInputGroup>
          <AutocompleteInput aria-label="Disabled tag autocomplete" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <AutocompleteList<Suggestion>>
                {(item) => <TagSuggestionItem key={item.value} item={item} />}
              </AutocompleteList>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
      <Autocomplete
        items={promptCompletions}
        itemToStringValue={getSuggestionLabel}
        defaultValue="summarize this conversation"
        mode="both"
        readOnly
      >
        <AutocompleteInputGroup>
          <AutocompleteInput aria-label="Read-only prompt autocomplete" />
          <AutocompleteClear />
          <AutocompleteTrigger />
        </AutocompleteInputGroup>
        <AutocompletePortal>
          <AutocompletePositioner>
            <AutocompletePopup>
              <AutocompleteList<Suggestion>>
                {(item) => <SuggestionItem key={item.value} item={item} />}
              </AutocompleteList>
            </AutocompletePopup>
          </AutocompletePositioner>
        </AutocompletePortal>
      </Autocomplete>
    </div>
  ),
}
