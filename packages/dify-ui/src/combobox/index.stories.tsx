import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Virtualizer } from '@tanstack/react-virtual'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as React from 'react'
import { expect } from 'storybook/test'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxFilter,
  useComboboxFilteredItems,
} from '.'
import { cn } from '../cn'
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '../field'

type Option = {
  value: string
  label: string
  meta?: string
  icon?: string
  disabled?: boolean
}

type OptionGroup = {
  label: string
  items: Option[]
}

const fieldWidth = 'w-80'

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

const providerOptions: Option[] = [
  { value: 'openai', label: 'OpenAI', meta: 'GPT-5, GPT-4.1', icon: 'i-ri-openai-fill' },
  { value: 'anthropic', label: 'Anthropic', meta: 'Claude Opus, Sonnet', icon: 'i-ri-sparkling-2-line' },
  { value: 'google', label: 'Google', meta: 'Gemini 2.5', icon: 'i-ri-google-fill' },
  { value: 'azure-openai', label: 'Azure OpenAI', meta: 'Enterprise workspace', icon: 'i-ri-microsoft-fill' },
  { value: 'localai', label: 'LocalAI', meta: 'Self-hosted endpoint', icon: 'i-ri-server-line', disabled: true },
]

const dataSourceOptions: Option[] = [
  { value: 'knowledge-base', label: 'Knowledge Base', meta: 'Vector index', icon: 'i-ri-database-2-line' },
  { value: 'notion', label: 'Notion', meta: 'Synced pages', icon: 'i-ri-notion-fill' },
  { value: 'website', label: 'Website crawler', meta: 'Public URLs', icon: 'i-ri-global-line' },
  { value: 's3', label: 'S3 bucket', meta: 'Private files', icon: 'i-ri-cloud-line' },
  { value: 'slack', label: 'Slack', meta: 'Channel history', icon: 'i-ri-slack-fill' },
]

const reviewerOptions: Option[] = [
  { value: 'maya', label: 'Maya Chen', meta: 'Product owner' },
  { value: 'liam', label: 'Liam Brooks', meta: 'Prompt engineer' },
  { value: 'nora', label: 'Nora Park', meta: 'Data steward' },
  { value: 'owen', label: 'Owen Reed', meta: 'Security reviewer' },
  { value: 'yuki', label: 'Yuki Tanaka', meta: 'ML engineer' },
]

const toolGroups: OptionGroup[] = [
  {
    label: 'Retrieval',
    items: [
      { value: 'dataset-search', label: 'Dataset search', meta: 'Search workspace knowledge', icon: 'i-ri-search-eye-line' },
      { value: 'web-scraper', label: 'Web scraper', meta: 'Fetch public pages', icon: 'i-ri-global-line' },
    ],
  },
  {
    label: 'Actions',
    items: [
      { value: 'http-request', label: 'HTTP request', meta: 'Call external APIs', icon: 'i-ri-terminal-box-line' },
      { value: 'code-runner', label: 'Code runner', meta: 'Execute sandboxed scripts', icon: 'i-ri-code-s-slash-line' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { value: 'human-review', label: 'Human review', meta: 'Assign approval task', icon: 'i-ri-user-voice-line' },
      { value: 'audit-log', label: 'Audit log', meta: 'Record workflow events', icon: 'i-ri-file-list-3-line' },
    ],
  },
]

const tagOptions: Option[] = [
  { value: 'rag', label: 'RAG' },
  { value: 'agent', label: 'Agent' },
  { value: 'production', label: 'Production' },
  { value: 'evaluation', label: 'Evaluation' },
  { value: 'finance', label: 'Finance' },
  { value: 'support', label: 'Support' },
]

const directoryOptions: Option[] = [
  { value: 'maya-chen', label: 'Maya Chen', meta: 'Product owner · maya@example.com', icon: 'i-ri-user-3-line' },
  { value: 'liam-brooks', label: 'Liam Brooks', meta: 'Prompt engineer · liam@example.com', icon: 'i-ri-user-3-line' },
  { value: 'nora-park', label: 'Nora Park', meta: 'Data steward · nora@example.com', icon: 'i-ri-user-3-line' },
  { value: 'owen-reed', label: 'Owen Reed', meta: 'Security reviewer · owen@example.com', icon: 'i-ri-shield-user-line' },
  { value: 'yuki-tanaka', label: 'Yuki Tanaka', meta: 'ML engineer · yuki@example.com', icon: 'i-ri-user-3-line' },
  { value: 'ava-martin', label: 'Ava Martin', meta: 'Support lead · ava@example.com', icon: 'i-ri-customer-service-2-line' },
]

const emptyOptions: Option[] = [
  { value: 'billing', label: 'Billing connector' },
  { value: 'zendesk', label: 'Zendesk' },
  { value: 'github', label: 'GitHub issues' },
]

const modelCatalogOptions: Option[] = Array.from({ length: 1000 }, (_, index) => {
  const provider = ['OpenAI', 'Anthropic', 'Google', 'Mistral', 'DeepSeek'][index % 5]!
  const family = ['chat', 'reasoning', 'vision', 'embedding'][index % 4]!
  const number = new Intl.NumberFormat('en-US', {
    minimumIntegerDigits: 4,
  }).format(index + 1)

  return {
    value: `model-${index + 1}`,
    label: `${provider} ${family} ${number}`,
    meta: `${provider} provider · ${family}`,
    icon: family === 'embedding'
      ? 'i-ri-vector-triangle'
      : family === 'vision'
        ? 'i-ri-image-circle-line'
        : family === 'reasoning'
          ? 'i-ri-brain-line'
          : 'i-ri-chat-1-line',
  }
})

const sizeOptions: Option[] = providerOptions.slice(0, 3)
const defaultProvider = providerOptions[0]!
const disabledProvider = providerOptions[1]!
const defaultDataSource = dataSourceOptions[0]!
const defaultPopupDataSource = dataSourceOptions[1]!
const readOnlyDataSource = dataSourceOptions[2]!
const defaultTool = toolGroups[0]!.items[0]!
const defaultReviewers = [reviewerOptions[0]!, reviewerOptions[1]!]
const defaultAsyncReviewers = [reviewerOptions[1]!]
const defaultTag = tagOptions[2]!

const getOptionLabel = (option: Option) => option.label

async function searchOptions(
  options: Option[],
  query: string,
  filter: (item: string, query: string) => boolean,
): Promise<{ items: Option[], error: string | null }> {
  await new Promise(resolve => window.setTimeout(resolve, 450))

  if (query === 'will_error') {
    return {
      items: [],
      error: 'Failed to fetch matches. Please try again.',
    }
  }

  return {
    items: options.filter(option => (
      filter(option.label, query)
      || (option.meta ? filter(option.meta, query) : false)
    )),
    error: null,
  }
}

const renderOptionItem = (option: Option) => (
  <ComboboxItem key={option.value} value={option} disabled={option.disabled} className="h-auto min-h-8 py-1.5">
    <ComboboxItemText className="flex items-center gap-2 px-0">
      {option.icon && <span aria-hidden className={cn(option.icon, 'size-4 shrink-0 text-text-tertiary')} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-text-secondary system-sm-medium">{option.label}</span>
        {option.meta && <span className="block truncate text-text-tertiary system-xs-regular">{option.meta}</span>}
      </span>
    </ComboboxItemText>
    <ComboboxItemIndicator />
  </ComboboxItem>
)

const renderSimpleOptionItem = (option: Option) => (
  <ComboboxItem key={option.value} value={option}>
    <ComboboxItemText>{option.label}</ComboboxItemText>
    <ComboboxItemIndicator />
  </ComboboxItem>
)

// Only virtualized items receive an explicit index; ordinary lists must let Base UI register items by DOM order for keyboard navigation.
const renderVirtualizedOptionItem = (option: Option, index: number) => (
  <ComboboxItem key={option.value} value={option} index={index} disabled={option.disabled} className="h-auto min-h-8 py-1.5">
    <ComboboxItemText className="flex items-center gap-2 px-0">
      {option.icon && <span aria-hidden className={cn(option.icon, 'size-4 shrink-0 text-text-tertiary')} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-text-secondary system-sm-medium">{option.label}</span>
        {option.meta && <span className="block truncate text-text-tertiary system-xs-regular">{option.meta}</span>}
      </span>
    </ComboboxItemText>
    <ComboboxItemIndicator />
  </ComboboxItem>
)

const PopupSearchInput = ({
  label,
  placeholder,
}: {
  label: string
  placeholder: string
}) => (
  <div className="p-1 pb-0">
    <ComboboxInputGroup className="h-8 min-h-8 px-2">
      <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
      <ComboboxInput aria-label={label} placeholder={`${placeholder}…`} className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled" />
      <ComboboxClear className="mr-0" />
    </ComboboxInputGroup>
  </div>
)

const GroupedToolList = () => {
  const groups = useComboboxFilteredItems<OptionGroup>()

  return (
    <ComboboxList>
      {groups.map((group, groupIndex) => (
        <ComboboxGroup key={group.label} items={group.items}>
          {groupIndex > 0 && <ComboboxSeparator />}
          <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
          <ComboboxCollection>
            {(option: Option) => renderOptionItem(option)}
          </ComboboxCollection>
        </ComboboxGroup>
      ))}
    </ComboboxList>
  )
}

const VirtualizedModelList = ({
  virtualizerRef,
}: {
  virtualizerRef: React.RefObject<StoryVirtualizer | null>
}) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const filteredItems = useComboboxFilteredItems<Option>()
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
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
      className="max-h-[min(22rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain outline-hidden"
    >
      <ComboboxList
        className="relative max-h-none overflow-visible p-0"
        style={{
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const option = filteredItems[virtualItem.index]

          if (!option)
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
              {renderVirtualizedOptionItem(option, virtualItem.index)}
            </div>
          )
        })}
      </ComboboxList>
    </div>
  )
}

const FilteredModelStatus = () => {
  const filteredItems = useComboboxFilteredItems<Option>()

  return (
    <ComboboxStatus className="border-y border-divider-subtle px-2 py-1 text-text-quaternary tabular-nums">
      {filteredItems.length}
      {' '}
      matching models
    </ComboboxStatus>
  )
}

const VirtualizedLongListDemo = () => {
  const [value, setValue] = React.useState<Option | null>(modelCatalogOptions[137]!)
  const virtualizerRef = React.useRef<StoryVirtualizer | null>(null)

  return (
    <div className={fieldWidth}>
      <Combobox
        items={modelCatalogOptions}
        value={value}
        onValueChange={setValue}
        virtualized
        onItemHighlighted={(item, details) => {
          scrollHighlightedVirtualItem(item, details, virtualizerRef.current)
        }}
      >
        <ComboboxLabel>Model catalog</ComboboxLabel>
        <ComboboxTrigger aria-label="Model catalog">
          <ComboboxValue placeholder="Select model" />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="w-[440px]">
          <PopupSearchInput label="Filter model catalog" placeholder="Filter 1,000 models" />
          <FilteredModelStatus />
          <VirtualizedModelList virtualizerRef={virtualizerRef} />
          <ComboboxEmpty>No model matches this filter</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

const AsyncDirectoryDemo = () => {
  const [searchResults, setSearchResults] = React.useState<Option[]>([])
  const [selectedValue, setSelectedValue] = React.useState<Option | null>(null)
  const [searchValue, setSearchValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const { contains } = useComboboxFilter()
  const abortControllerRef = React.useRef<AbortController | null>(null)
  const trimmedSearchValue = searchValue.trim()
  const items = React.useMemo(() => {
    if (!selectedValue || searchResults.some(option => option.value === selectedValue.value))
      return searchResults

    return [...searchResults, selectedValue]
  }, [searchResults, selectedValue])

  const status = (() => {
    if (isPending)
      return 'Searching directory matches…'

    if (error)
      return error

    if (trimmedSearchValue === '')
      return selectedValue ? null : 'Start typing to search owners…'

    if (searchResults.length === 0)
      return `No matches for "${trimmedSearchValue}".`

    return `${searchResults.length} owner${searchResults.length === 1 ? '' : 's'} found`
  })()

  const emptyMessage = trimmedSearchValue === '' || isPending || searchResults.length > 0 || error
    ? null
    : 'Try a different owner search.'

  return (
    <Field name="owner" className={fieldWidth}>
      <FieldLabel>Owner</FieldLabel>
      <Combobox
        items={items}
        itemToStringLabel={getOptionLabel}
        filter={null}
        value={selectedValue}
        onOpenChangeComplete={(open) => {
          if (!open && selectedValue)
            setSearchResults([selectedValue])
        }}
        onValueChange={(nextSelectedValue) => {
          setSelectedValue(nextSelectedValue)
          setSearchValue('')
          setError(null)
        }}
        onInputValueChange={(nextSearchValue, { reason }) => {
          setSearchValue(nextSearchValue)

          if (nextSearchValue === '') {
            setSearchResults([])
            setError(null)
            return
          }

          if (reason === 'item-press')
            return

          const controller = new AbortController()
          abortControllerRef.current?.abort()
          abortControllerRef.current = controller

          startTransition(async () => {
            setError(null)

            const result = await searchOptions(directoryOptions, nextSearchValue, contains)

            if (controller.signal.aborted)
              return

            startTransition(() => {
              setSearchResults(result.items)
              setError(result.error)
            })
          })
        }}
      >
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
          <ComboboxInput placeholder="Search owners…" className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled" />
          <ComboboxClear className="mr-0.5" />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxContent popupClassName="w-[420px]" popupProps={{ 'aria-busy': isPending || undefined }}>
          <ComboboxStatus className="border-b border-divider-subtle">
            {status}
          </ComboboxStatus>
          <ComboboxList>{renderOptionItem}</ComboboxList>
          <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}

const AsyncReviewerDemo = () => {
  const [searchResults, setSearchResults] = React.useState<Option[]>([])
  const [selectedValues, setSelectedValues] = React.useState<Option[]>(defaultAsyncReviewers)
  const [searchValue, setSearchValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [blockStartStatus, setBlockStartStatus] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const { contains } = useComboboxFilter()
  const abortControllerRef = React.useRef<AbortController | null>(null)
  const selectedValuesRef = React.useRef<Option[]>(defaultAsyncReviewers)
  const trimmedSearchValue = searchValue.trim()

  const items = React.useMemo(() => {
    if (selectedValues.length === 0)
      return searchResults

    const merged = [...searchResults]

    selectedValues.forEach((selected) => {
      if (!searchResults.some(result => result.value === selected.value))
        merged.push(selected)
    })

    return merged
  }, [searchResults, selectedValues])

  const status = (() => {
    if (isPending)
      return 'Searching reviewer matches…'

    if (error)
      return error

    if (trimmedSearchValue === '' && !blockStartStatus)
      return selectedValues.length > 0 ? null : 'Start typing to search reviewers…'

    if (searchResults.length === 0 && !blockStartStatus)
      return `No matches for "${trimmedSearchValue}".`

    return `${searchResults.length} reviewer${searchResults.length === 1 ? '' : 's'} found`
  })()

  const emptyMessage = trimmedSearchValue === '' || isPending || searchResults.length > 0 || error
    ? null
    : 'Try a different reviewer search.'

  return (
    <Field name="asyncReviewers" className={fieldWidth}>
      <FieldLabel>Async reviewers</FieldLabel>
      <Combobox
        items={items}
        itemToStringLabel={getOptionLabel}
        multiple
        filter={null}
        value={selectedValues}
        onOpenChangeComplete={(open) => {
          if (!open) {
            setSearchResults(selectedValuesRef.current)
            setBlockStartStatus(false)
          }
        }}
        onValueChange={(nextSelectedValues) => {
          selectedValuesRef.current = nextSelectedValues
          setSelectedValues(nextSelectedValues)
          setSearchValue('')
          setError(null)

          if (nextSelectedValues.length === 0) {
            setSearchResults([])
            setBlockStartStatus(false)
          }
          else {
            setBlockStartStatus(true)
          }
        }}
        onInputValueChange={(nextSearchValue, { reason }) => {
          setSearchValue(nextSearchValue)

          const controller = new AbortController()
          abortControllerRef.current?.abort()
          abortControllerRef.current = controller

          if (nextSearchValue === '') {
            setSearchResults(selectedValuesRef.current)
            setError(null)
            setBlockStartStatus(false)
            return
          }

          if (reason === 'item-press')
            return

          startTransition(async () => {
            setError(null)

            const result = await searchOptions(reviewerOptions, nextSearchValue, contains)

            if (controller.signal.aborted)
              return

            startTransition(() => {
              setSearchResults(result.items)
              setError(result.error)
            })
          })
        }}
      >
        <ComboboxInputGroup className="h-auto min-h-8 items-start py-1">
          <ComboboxChips>
            <ComboboxValue>
              {(selectedValue: Option[]) => (
                <React.Fragment>
                  {selectedValue.map(item => (
                    <ComboboxChip key={item.value} aria-label={item.label}>
                      <span className="max-w-32 truncate">{item.label}</span>
                      <ComboboxChipRemove aria-label={`Remove ${item.label}`} />
                    </ComboboxChip>
                  ))}
                  <ComboboxInput placeholder={selectedValue.length ? '' : 'Search reviewers…'} className="min-w-24 px-1 py-0.5" />
                </React.Fragment>
              )}
            </ComboboxValue>
          </ComboboxChips>
        </ComboboxInputGroup>
        <ComboboxContent popupClassName="w-[420px]" popupProps={{ 'aria-busy': isPending || undefined }}>
          <ComboboxStatus className="border-b border-divider-subtle">
            {status}
          </ComboboxStatus>
          <ComboboxList>{renderOptionItem}</ComboboxList>
          <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>Selected reviewers stay available while async matches change.</FieldDescription>
    </Field>
  )
}

const meta = {
  title: 'Base/Form/Combobox',
  component: Combobox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound combobox built on Base UI Combobox for searchable predefined selections. Compose triggers, inputs, lists, groups, status, empty states, and chips without importing Base UI primitives directly.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Combobox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Field name="dataSource" className={fieldWidth}>
      <FieldLabel>Connect source</FieldLabel>
      <Combobox items={dataSourceOptions} defaultValue={defaultDataSource}>
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
          <ComboboxInput placeholder="Search data sources…" className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled" />
          <ComboboxClear className="mr-0.5" />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxList>{renderSimpleOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  ),
}

export const FormField: Story = {
  render: () => (
    <Field name="sourceConnector" className={fieldWidth}>
      <FieldLabel>Connect source</FieldLabel>
      <Combobox items={dataSourceOptions} defaultValue={defaultDataSource}>
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
          <ComboboxInput placeholder="Search data sources…" className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled" />
          <ComboboxClear className="mr-0.5" />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxList>{renderSimpleOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>Type to filter, then choose a remembered data source.</FieldDescription>
    </Field>
  ),
}

export const CompactTriggerWithPopupSearch: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={dataSourceOptions} defaultValue={defaultPopupDataSource}>
        <ComboboxLabel>Data source</ComboboxLabel>
        <ComboboxTrigger aria-label="Data source">
          <ComboboxValue placeholder="Choose source" />
        </ComboboxTrigger>
        <ComboboxContent>
          <PopupSearchInput label="Search data sources" placeholder="Search sources" />
          <ComboboxList>{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

export const AsyncSearchSingle: Story = {
  render: () => <AsyncDirectoryDemo />,
}

export const AsyncSearchMultiple: Story = {
  render: () => <AsyncReviewerDemo />,
}

export const Sizes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {(['small', 'medium', 'large'] as const).map(size => (
        <Field key={size} name={`provider-${size}`}>
          <FieldLabel>{`${size[0]!.toUpperCase()}${size.slice(1)}`}</FieldLabel>
          <Combobox items={sizeOptions} defaultValue={defaultProvider}>
            <ComboboxInputGroup size={size} className="px-2">
              <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
              <ComboboxInput size={size} placeholder="Search providers…" className="px-1" />
              <ComboboxClear size={size} className="mr-0.5" />
              <ComboboxInputTrigger size={size} className="mr-0" />
            </ComboboxInputGroup>
            <ComboboxContent>
              <ComboboxList>{renderOptionItem}</ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Field>
      ))}
    </div>
  ),
}

export const Grouped: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={toolGroups} defaultValue={defaultTool}>
        <ComboboxLabel>Workflow tool</ComboboxLabel>
        <ComboboxTrigger aria-label="Workflow tool">
          <ComboboxValue placeholder="Select tool" />
        </ComboboxTrigger>
        <ComboboxContent>
          <PopupSearchInput label="Search workflow tools" placeholder="Search workflow tools" />
          <GroupedToolList />
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

const MultipleChipsDemo = () => {
  const [value, setValue] = React.useState<Option[]>(defaultReviewers)

  return (
    <Field name="reviewers" className={fieldWidth}>
      <FieldLabel>Reviewers</FieldLabel>
      <Combobox items={reviewerOptions} multiple value={value} onValueChange={setValue}>
        <ComboboxInputGroup className="h-auto min-h-8 items-start py-1">
          <ComboboxChips>
            <ComboboxValue>
              {(selectedValue: Option[]) => (
                <React.Fragment>
                  {selectedValue.map(item => (
                    <ComboboxChip key={item.value}>
                      <span className="max-w-32 truncate">{item.label}</span>
                      <ComboboxChipRemove aria-label={`Remove ${item.label}`} />
                    </ComboboxChip>
                  ))}
                  <ComboboxInput placeholder={selectedValue.length ? '' : 'Assign reviewers…'} className="min-w-24 px-1 py-0.5" />
                </React.Fragment>
              )}
            </ComboboxValue>
          </ComboboxChips>
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxList>{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>Selected reviewers wrap inside the input instead of scrolling horizontally.</FieldDescription>
    </Field>
  )
}

export const MultipleChips: Story = {
  render: () => <MultipleChipsDemo />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Maya Chen')).toBeVisible()
    await expect(canvas.getByText('Liam Brooks')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Remove Maya Chen' }))

    await expect(canvas.queryByText('Maya Chen')).not.toBeInTheDocument()
    await expect(canvas.getByText('Liam Brooks')).toBeVisible()
  },
}

export const VirtualizedLongList: Story = {
  render: () => <VirtualizedLongListDemo />,
}

export const EmptyAndStatus: Story = {
  render: () => (
    <Field name="connector" className={fieldWidth}>
      <FieldLabel>Connector</FieldLabel>
      <Combobox items={emptyOptions} defaultInputValue="salesforce">
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span aria-hidden className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder" />
          <ComboboxInput placeholder="Search connectors…" className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled" />
          <ComboboxClear className="mr-0.5" />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxStatus>Search workspace connectors</ComboboxStatus>
          <ComboboxEmpty>No connectors found</ComboboxEmpty>
          <ComboboxList>{renderSimpleOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  ),
}

export const DisabledAndReadOnly: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Field name="disabledProvider" disabled>
        <Combobox items={providerOptions} defaultValue={disabledProvider} disabled>
          <ComboboxLabel>Disabled provider</ComboboxLabel>
          <ComboboxTrigger aria-label="Disabled model provider">
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxContent>
            <PopupSearchInput label="Search disabled providers" placeholder="Search providers" />
            <ComboboxList>{renderOptionItem}</ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
      <Field name="readOnlySource">
        <FieldLabel>Read-only source</FieldLabel>
        <Combobox items={dataSourceOptions} defaultValue={readOnlyDataSource} readOnly>
          <ComboboxInputGroup className="h-8 min-h-8 px-2">
            <ComboboxInput placeholder="Read-only data source…" className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled" />
            <ComboboxClear className="mr-0.5" />
            <ComboboxInputTrigger className="mr-0" />
          </ComboboxInputGroup>
          <ComboboxContent>
            <ComboboxList>{renderOptionItem}</ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
    </div>
  ),
}

const ControlledDemo = () => {
  const [value, setValue] = React.useState<Option | null>(defaultTag)

  return (
    <div className="flex w-80 flex-col items-start gap-3">
      <div className="w-full">
        <Combobox items={tagOptions} value={value} onValueChange={setValue}>
          <ComboboxLabel>Default app tag</ComboboxLabel>
          <ComboboxTrigger aria-label="Default app tag">
            <ComboboxValue placeholder="Select tag" />
          </ComboboxTrigger>
          <ComboboxContent>
            <PopupSearchInput label="Search app tags" placeholder="Search tags" />
            <ComboboxList>{renderSimpleOptionItem}</ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      <span className="rounded-md border border-divider-subtle bg-components-panel-bg px-2 py-1 text-text-tertiary system-xs-regular">
        Selected:
        {' '}
        {value?.label ?? 'None'}
      </span>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}
