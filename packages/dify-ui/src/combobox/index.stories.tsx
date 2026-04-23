import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
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
  useComboboxFilteredItems,
} from '.'
import { cn } from '../cn'

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
const wideFieldWidth = 'w-[520px]'
const nativeFieldLabelClassName = 'mb-1 block text-text-secondary system-sm-medium'

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
const defaultReviewers = [reviewerOptions[0]!, reviewerOptions[2]!]
const defaultTag = tagOptions[2]!

const renderOptionItem = (option: Option, index?: number) => (
  <ComboboxItem key={option.value} value={option} index={index} disabled={option.disabled}>
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

const renderSimpleOptionItem = (option: Option, index?: number) => (
  <ComboboxItem key={option.value} value={option} index={index}>
    <ComboboxItemText>{option.label}</ComboboxItemText>
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
  <ComboboxInputGroup className="mb-1 border-divider-subtle bg-components-input-bg-normal">
    <span aria-hidden className="ml-2 i-ri-search-line size-4 shrink-0 text-text-tertiary" />
    <ComboboxInput aria-label={label} placeholder={`${placeholder}…`} className="pl-2" />
    <ComboboxClear />
  </ComboboxInputGroup>
)

const GroupedToolList = () => {
  const groups = useComboboxFilteredItems<OptionGroup>()

  return (
    <ComboboxList className="p-0">
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
  virtualizerRef: RefObject<StoryVirtualizer | null>
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const filteredItems = useComboboxFilteredItems<Option>()
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
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
              {renderOptionItem(option, virtualItem.index)}
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
  const [value, setValue] = useState<Option | null>(modelCatalogOptions[137]!)
  const virtualizerRef = useRef<StoryVirtualizer | null>(null)

  return (
    <div className={fieldWidth}>
      <Combobox
        items={modelCatalogOptions}
        value={value}
        onValueChange={setValue}
        virtualized
        autoHighlight
        onItemHighlighted={(item, details) => {
          scrollHighlightedVirtualItem(item, details, virtualizerRef.current)
        }}
      >
        <ComboboxLabel>Model catalog</ComboboxLabel>
        <ComboboxTrigger aria-label="Model catalog">
          <ComboboxValue placeholder="Select model" />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="w-[440px] p-1">
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
  const [inputValue, setInputValue] = useState('ma')
  const [value, setValue] = useState<Option | null>(null)
  const [items, setItems] = useState(directoryOptions.slice(0, 3))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const timeout = window.setTimeout(() => {
      const query = inputValue.trim().toLowerCase()
      setItems(
        query
          ? directoryOptions.filter(option => `${option.label} ${option.meta}`.toLowerCase().includes(query))
          : directoryOptions.slice(0, 5),
      )
      setLoading(false)
    }, 450)

    return () => window.clearTimeout(timeout)
  }, [inputValue])

  return (
    <div className={fieldWidth}>
      <Combobox
        items={value && !items.some(item => item.value === value.value) ? [value, ...items] : items}
        value={value}
        onValueChange={setValue}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        autoHighlight
      >
        <label className={nativeFieldLabelClassName}>
          Owner
          <ComboboxInputGroup className="mt-1">
            <span aria-hidden className="ml-3 i-ri-search-line size-4 shrink-0 text-text-tertiary" />
            <ComboboxInput placeholder="Search owners…" className="pl-2" />
            <ComboboxClear />
            <ComboboxInputTrigger />
          </ComboboxInputGroup>
        </label>
        <ComboboxContent popupClassName="w-[420px]">
          <ComboboxStatus className="border-b border-divider-subtle">
            {loading ? 'Loading directory matches…' : `${items.length} selectable owners`}
          </ComboboxStatus>
          <ComboboxList>{renderOptionItem}</ComboboxList>
          <ComboboxEmpty>No owner matches this query</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

const meta = {
  title: 'Base/UI/Combobox',
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

export const SelectLikeDefault: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={providerOptions} defaultValue={defaultProvider} autoHighlight>
        <ComboboxLabel>Model provider</ComboboxLabel>
        <ComboboxTrigger aria-label="Model provider">
          <ComboboxValue placeholder="Select provider" />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="p-1">
          <PopupSearchInput label="Search model providers" placeholder="Search providers" />
          <ComboboxList className="p-0">{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

export const PopupInputSearchableSelect: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={dataSourceOptions} defaultValue={defaultPopupDataSource} autoHighlight>
        <ComboboxLabel>Data source</ComboboxLabel>
        <ComboboxTrigger aria-label="Data source">
          <ComboboxValue placeholder="Choose source" />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="p-1">
          <PopupSearchInput label="Search data sources" placeholder="Search sources" />
          <ComboboxList className="p-0">{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

export const AsyncSearchSingle: Story = {
  render: () => <AsyncDirectoryDemo />,
}

export const InputGroupSearchable: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={dataSourceOptions} defaultValue={defaultDataSource} autoHighlight>
        <label className={nativeFieldLabelClassName}>
          Connect source
          <ComboboxInputGroup className="mt-1">
            <span aria-hidden className="ml-3 i-ri-search-line size-4 shrink-0 text-text-tertiary" />
            <ComboboxInput placeholder="Search data sources…" className="pl-2" />
            <ComboboxClear />
            <ComboboxInputTrigger />
          </ComboboxInputGroup>
        </label>
        <ComboboxContent>
          <ComboboxList>{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {(['small', 'medium', 'large'] as const).map(size => (
        <Combobox key={size} items={sizeOptions} defaultValue={defaultProvider} autoHighlight>
          <ComboboxTrigger aria-label={`${size} model provider`} size={size}>
            <ComboboxValue />
          </ComboboxTrigger>
          <ComboboxContent popupClassName="p-1">
            <PopupSearchInput label={`Search ${size} model providers`} placeholder="Search providers" />
            <ComboboxList className="p-0">{renderOptionItem}</ComboboxList>
          </ComboboxContent>
        </Combobox>
      ))}
    </div>
  ),
}

export const Grouped: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={toolGroups} defaultValue={defaultTool} autoHighlight>
        <ComboboxLabel>Workflow tool</ComboboxLabel>
        <ComboboxTrigger aria-label="Workflow tool">
          <ComboboxValue placeholder="Select tool" />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="p-1">
          <PopupSearchInput label="Search workflow tools" placeholder="Search workflow tools" />
          <GroupedToolList />
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

const MultipleChipsDemo = () => {
  const [value, setValue] = useState<Option[]>(defaultReviewers)

  return (
    <div className={wideFieldWidth}>
      <Combobox items={reviewerOptions} multiple value={value} onValueChange={setValue} autoHighlight>
        <label className={nativeFieldLabelClassName}>
          Reviewers
          <ComboboxInputGroup className="mt-1 h-auto min-h-8 flex-nowrap py-1">
            <ComboboxValue>
              {(selectedValue: Option[]) => (
                <>
                  <ComboboxChips className="flex-nowrap">
                    {selectedValue.map(item => (
                      <ComboboxChip key={item.value}>
                        <span className="max-w-32 truncate">{item.label}</span>
                        <ComboboxChipRemove aria-label={`Remove ${item.label}`} />
                      </ComboboxChip>
                    ))}
                  </ComboboxChips>
                  <ComboboxInput placeholder={selectedValue.length ? '' : 'Assign reviewers…'} className="min-w-16 px-2" />
                </>
              )}
            </ComboboxValue>
            <ComboboxClear />
            <ComboboxInputTrigger />
          </ComboboxInputGroup>
        </label>
        <ComboboxContent>
          <ComboboxList>{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

export const MultipleChips: Story = {
  render: () => <MultipleChipsDemo />,
}

export const VirtualizedLongList: Story = {
  render: () => <VirtualizedLongListDemo />,
}

export const EmptyAndStatus: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={emptyOptions} defaultInputValue="salesforce" autoHighlight>
        <label className={nativeFieldLabelClassName}>
          Connector
          <ComboboxInputGroup className="mt-1">
            <span aria-hidden className="ml-3 i-ri-search-line size-4 shrink-0 text-text-tertiary" />
            <ComboboxInput placeholder="Search connectors…" className="pl-2" />
            <ComboboxClear />
            <ComboboxInputTrigger />
          </ComboboxInputGroup>
        </label>
        <ComboboxContent>
          <ComboboxStatus>Search workspace connectors</ComboboxStatus>
          <ComboboxEmpty>No connectors found</ComboboxEmpty>
          <ComboboxList>{renderSimpleOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

export const DisabledAndReadOnly: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Combobox items={providerOptions} defaultValue={disabledProvider} disabled>
        <ComboboxLabel>Disabled provider</ComboboxLabel>
        <ComboboxTrigger aria-label="Disabled model provider">
          <ComboboxValue />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="p-1">
          <PopupSearchInput label="Search disabled providers" placeholder="Search providers" />
          <ComboboxList className="p-0">{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Combobox items={dataSourceOptions} defaultValue={readOnlyDataSource} readOnly>
        <label className={nativeFieldLabelClassName}>
          Read-only source
          <ComboboxInputGroup className="mt-1">
            <ComboboxInput placeholder="Read-only data source…" />
            <ComboboxClear />
            <ComboboxInputTrigger />
          </ComboboxInputGroup>
        </label>
        <ComboboxContent>
          <ComboboxList>{renderOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
}

const ControlledDemo = () => {
  const [value, setValue] = useState<Option | null>(defaultTag)

  return (
    <div className="flex w-80 flex-col items-start gap-3">
      <Combobox items={tagOptions} value={value} onValueChange={setValue}>
        <ComboboxLabel>Default app tag</ComboboxLabel>
        <ComboboxTrigger aria-label="Default app tag">
          <ComboboxValue placeholder="Select tag" />
        </ComboboxTrigger>
        <ComboboxContent popupClassName="p-1">
          <PopupSearchInput label="Search app tags" placeholder="Search tags" />
          <ComboboxList className="p-0">{renderSimpleOptionItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
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
