import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Virtualizer } from '@tanstack/react-virtual'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as React from 'react'
import { expect, waitFor, within } from 'storybook/test'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
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
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxFilter,
  useComboboxFilteredItems,
} from '.'
import { Button } from '../button'
import { cn } from '../cn'
import { Field, FieldDescription, FieldLabel } from '../field'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../popover'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../scroll-area'

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

const providerOptions: Option[] = [
  { value: 'openai', label: 'OpenAI', meta: 'GPT-5, GPT-4.1', icon: 'i-ri-openai-fill' },
  {
    value: 'anthropic',
    label: 'Anthropic',
    meta: 'Claude Opus, Sonnet',
    icon: 'i-ri-sparkling-2-line',
  },
  { value: 'google', label: 'Google', meta: 'Gemini 2.5', icon: 'i-ri-google-fill' },
  {
    value: 'azure-openai',
    label: 'Azure OpenAI',
    meta: 'Enterprise workspace',
    icon: 'i-ri-microsoft-fill',
  },
  {
    value: 'localai',
    label: 'LocalAI',
    meta: 'Self-hosted endpoint',
    icon: 'i-ri-server-line',
    disabled: true,
  },
]

const dataSourceOptions: Option[] = [
  {
    value: 'knowledge-base',
    label: 'Knowledge Base',
    meta: 'Vector index',
    icon: 'i-ri-database-2-line',
  },
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
      {
        value: 'dataset-search',
        label: 'Dataset search',
        meta: 'Search workspace knowledge',
        icon: 'i-ri-search-eye-line',
      },
      {
        value: 'web-scraper',
        label: 'Web scraper',
        meta: 'Fetch public pages',
        icon: 'i-ri-global-line',
      },
    ],
  },
  {
    label: 'Actions',
    items: [
      {
        value: 'http-request',
        label: 'HTTP request',
        meta: 'Call external APIs',
        icon: 'i-ri-terminal-box-line',
      },
      {
        value: 'code-runner',
        label: 'Code runner',
        meta: 'Execute sandboxed scripts',
        icon: 'i-ri-code-s-slash-line',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        value: 'human-review',
        label: 'Human review',
        meta: 'Assign approval task',
        icon: 'i-ri-user-voice-line',
      },
      {
        value: 'audit-log',
        label: 'Audit log',
        meta: 'Record workflow events',
        icon: 'i-ri-file-list-3-line',
      },
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
  {
    value: 'maya-chen',
    label: 'Maya Chen',
    meta: 'Product owner · maya@example.com',
    icon: 'i-ri-user-3-line',
  },
  {
    value: 'liam-brooks',
    label: 'Liam Brooks',
    meta: 'Prompt engineer · liam@example.com',
    icon: 'i-ri-user-3-line',
  },
  {
    value: 'nora-park',
    label: 'Nora Park',
    meta: 'Data steward · nora@example.com',
    icon: 'i-ri-user-3-line',
  },
  {
    value: 'owen-reed',
    label: 'Owen Reed',
    meta: 'Security reviewer · owen@example.com',
    icon: 'i-ri-shield-user-line',
  },
  {
    value: 'yuki-tanaka',
    label: 'Yuki Tanaka',
    meta: 'ML engineer · yuki@example.com',
    icon: 'i-ri-user-3-line',
  },
  {
    value: 'ava-martin',
    label: 'Ava Martin',
    meta: 'Support lead · ava@example.com',
    icon: 'i-ri-customer-service-2-line',
  },
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
    icon:
      family === 'embedding'
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
const defaultTag = tagOptions[2]!

const getOptionLabel = (option: Option) => option.label

async function searchOptions(
  options: Option[],
  query: string,
  filter: (item: string, query: string) => boolean,
): Promise<{ items: Option[]; error: string | null }> {
  await new Promise((resolve) => window.setTimeout(resolve, 450))

  if (query === 'will_error') {
    return {
      items: [],
      error: 'Failed to fetch matches. Please try again.',
    }
  }

  return {
    items: options.filter(
      (option) => filter(option.label, query) || (option.meta ? filter(option.meta, query) : false),
    ),
    error: null,
  }
}

const renderOptionItem = (option: Option) => (
  <ComboboxItem
    key={option.value}
    value={option}
    disabled={option.disabled}
    className="h-auto min-h-8 py-1.5"
  >
    <ComboboxItemText className="flex items-center gap-2 px-0">
      {option.icon && (
        <span aria-hidden className={cn(option.icon, 'size-4 shrink-0 text-text-tertiary')} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate system-sm-medium text-text-secondary">{option.label}</span>
        {option.meta && (
          <span className="block truncate system-xs-regular text-text-tertiary">{option.meta}</span>
        )}
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
const renderVirtualizedOptionItem = (option: Option, index: number, itemCount: number) => (
  <ComboboxItem
    key={option.value}
    value={option}
    index={index}
    aria-posinset={index + 1}
    aria-setsize={itemCount}
    disabled={option.disabled}
    className="h-auto min-h-8 py-1.5"
  >
    <ComboboxItemText className="flex items-center gap-2 px-0">
      {option.icon && (
        <span aria-hidden className={cn(option.icon, 'size-4 shrink-0 text-text-tertiary')} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate system-sm-medium text-text-secondary">{option.label}</span>
        {option.meta && (
          <span className="block truncate system-xs-regular text-text-tertiary">{option.meta}</span>
        )}
      </span>
    </ComboboxItemText>
    <ComboboxItemIndicator />
  </ComboboxItem>
)

const PopupSearchInput = ({ label, placeholder }: { label: string; placeholder: string }) => (
  <div className="p-1 pb-0">
    <ComboboxInputGroup className="h-8 min-h-8 px-2">
      <span
        aria-hidden
        className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
      />
      <ComboboxInput
        aria-label={label}
        placeholder={`${placeholder}…`}
        className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
      />
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
          <ComboboxCollection<Option>>{(option) => renderOptionItem(option)}</ComboboxCollection>
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
    <ScrollArea className="relative overflow-hidden">
      <ScrollAreaViewport
        ref={scrollRef}
        role="region"
        aria-label="Model catalog"
        className="max-h-[min(22rem,var(--available-height))] overscroll-contain"
        style={{ overflowX: 'hidden' }}
      >
        <ScrollAreaContent style={{ minWidth: 0 }}>
          <ComboboxList
            className="relative max-h-none overflow-visible p-0"
            style={{
              height: virtualizer.getTotalSize(),
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const option = filteredItems[virtualItem.index]

              if (!option) return null

              return (
                <div
                  key={virtualItem.key}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    height: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {renderVirtualizedOptionItem(option, virtualItem.index, filteredItems.length)}
                </div>
              )
            })}
          </ComboboxList>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}

const FilteredModelStatus = () => {
  const filteredItems = useComboboxFilteredItems<Option>()

  return (
    <ComboboxStatus className="border-y border-divider-subtle px-2 py-1 text-text-quaternary tabular-nums">
      {filteredItems.length} matching models
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
        <ComboboxTrigger>
          <ComboboxValue placeholder="Select model" />
        </ComboboxTrigger>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup className="w-110" aria-label="Model catalog">
              <PopupSearchInput label="Filter model catalog" placeholder="Filter 1,000 models" />
              <FilteredModelStatus />
              <VirtualizedModelList virtualizerRef={virtualizerRef} />
              <ComboboxEmpty>No model matches this filter</ComboboxEmpty>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
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
    if (!selectedValue || searchResults.some((option) => option.value === selectedValue.value))
      return searchResults

    return [...searchResults, selectedValue]
  }, [searchResults, selectedValue])

  const status = (() => {
    if (isPending) return 'Searching directory matches…'

    if (error) return error

    if (trimmedSearchValue === '') return selectedValue ? null : 'Start typing to search owners…'

    if (searchResults.length === 0) return `No matches for "${trimmedSearchValue}".`

    return `${searchResults.length} owner${searchResults.length === 1 ? '' : 's'} found`
  })()

  const emptyMessage =
    trimmedSearchValue === '' || isPending || searchResults.length > 0 || error
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
          if (!open && selectedValue) setSearchResults([selectedValue])
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

          if (reason === 'item-press') return

          const controller = new AbortController()
          abortControllerRef.current?.abort()
          abortControllerRef.current = controller

          startTransition(async () => {
            setError(null)

            const result = await searchOptions(directoryOptions, nextSearchValue, contains)

            if (controller.signal.aborted) return

            startTransition(() => {
              setSearchResults(result.items)
              setError(result.error)
            })
          })
        }}
      >
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span
            aria-hidden
            className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
          />
          <ComboboxInput
            placeholder="Search owners…"
            className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
          />
          <ComboboxClear className="mr-0.5" />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup className="w-105" aria-busy={isPending || undefined}>
              <ComboboxStatus className="border-b border-divider-subtle">{status}</ComboboxStatus>
              <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
              <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </Field>
  )
}

const InlinePopoverDemo = () => {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState<Option | null>(null)
  const [inputValue, setInputValue] = React.useState('')

  return (
    <div className="flex w-80 flex-col items-start gap-3">
      <Popover
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) setInputValue('')
        }}
      >
        <PopoverTrigger render={<Button variant="secondary" />}>Choose reviewer</PopoverTrigger>
        <PopoverContent placement="bottom-start" sideOffset={4} className="w-80 p-0">
          <PopoverTitle className="sr-only">Choose reviewer</PopoverTitle>
          <Combobox
            inline
            open={open}
            items={reviewerOptions}
            value={value}
            inputValue={inputValue}
            itemToStringLabel={getOptionLabel}
            onOpenChange={setOpen}
            onValueChange={setValue}
            onInputValueChange={setInputValue}
          >
            <div className="p-2 pb-1">
              <ComboboxInputGroup className="h-8 min-h-8 px-2">
                <span
                  aria-hidden
                  className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
                />
                <ComboboxInput
                  aria-label="Search reviewers"
                  placeholder="Search reviewers…"
                  className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
                />
              </ComboboxInputGroup>
            </div>
            <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
            <ComboboxEmpty>No reviewers found</ComboboxEmpty>
          </Combobox>
        </PopoverContent>
      </Popover>
      <span className="system-xs-regular text-text-tertiary">
        Selected reviewer: {value?.label ?? 'None'}
      </span>
    </div>
  )
}

const meta = {
  title: 'Base/Form/Combobox',
  component: Combobox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound combobox built on Base UI Combobox for searchable predefined selections. Use an input as the trigger, place an input inside a named popup, or set `inline` when an external Popover owns the surface. Keep independent actions outside the listbox, keep Status mounted while changing its children, and use Clear only for selection clearing.',
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
          <span
            aria-hidden
            className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
          />
          <ComboboxInput
            placeholder="Search data sources…"
            className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
          />
          <ComboboxClear className="mr-0.5" />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxList<Option>>{renderSimpleOptionItem}</ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
      <FieldDescription>Type to filter, then choose a remembered data source.</FieldDescription>
    </Field>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const input = canvas.getByRole('combobox', { name: 'Connect source' })
    const body = within(canvasElement.ownerDocument.body)

    await expect(input).toHaveValue('Knowledge Base')
    await userEvent.clear(input)
    await userEvent.type(input, 'Notion')
    await waitFor(async () => {
      await expect(body.getByRole('option', { name: 'Notion' })).toBeVisible()
    })

    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(input).toHaveValue('Notion')
  },
}

export const TriggerWithPopupInput: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={dataSourceOptions} defaultValue={defaultPopupDataSource}>
        <ComboboxLabel>Data source</ComboboxLabel>
        <ComboboxTrigger>
          <ComboboxValue placeholder="Choose source" />
        </ComboboxTrigger>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup aria-label="Data source">
              <PopupSearchInput label="Search data sources" placeholder="Search sources" />
              <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Data source' })
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(trigger)
    const popup = await body.findByRole('dialog', { name: 'Data source' })
    const input = within(popup).getByRole('combobox', { name: 'Search data sources' })
    await userEvent.type(input, 'Website')
    await userEvent.click(within(popup).getByRole('option', { name: /Website crawler/ }))

    await expect(trigger).toHaveTextContent('Website crawler')
    await waitFor(async () => {
      await expect(body.queryByRole('dialog', { name: 'Data source' })).not.toBeInTheDocument()
    })
  },
}

export const InlineInPopover: Story = {
  render: () => <InlinePopoverDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Choose reviewer' }))
    const popover = await body.findByRole('dialog', { name: 'Choose reviewer' })
    const input = within(popover).getByRole('combobox', { name: 'Search reviewers' })
    await userEvent.type(input, 'Nora')
    await userEvent.click(within(popover).getByRole('option', { name: /Nora Park/ }))

    await expect(canvas.getByText('Selected reviewer: Nora Park')).toBeVisible()
    await waitFor(async () => {
      await expect(body.queryByRole('dialog', { name: 'Choose reviewer' })).not.toBeInTheDocument()
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Choose reviewer' }))
    const reopenedPopover = await body.findByRole('dialog', { name: 'Choose reviewer' })
    await expect(
      within(reopenedPopover).getByRole('combobox', { name: 'Search reviewers' }),
    ).toHaveValue('')
  },
}

export const AsyncSearch: Story = {
  render: () => <AsyncDirectoryDemo />,
}

export const Sizes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {(['small', 'medium', 'large'] as const).map((size) => (
        <Field key={size} name={`provider-${size}`}>
          <FieldLabel>{`${size[0]!.toUpperCase()}${size.slice(1)}`}</FieldLabel>
          <Combobox items={sizeOptions} defaultValue={defaultProvider}>
            <ComboboxInputGroup size={size} className="px-2">
              <span
                aria-hidden
                className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
              />
              <ComboboxInput size={size} placeholder="Search providers…" className="px-1" />
              <ComboboxClear size={size} className="mr-0.5" />
              <ComboboxInputTrigger size={size} className="mr-0" />
            </ComboboxInputGroup>
            <ComboboxPortal>
              <ComboboxPositioner>
                <ComboboxPopup>
                  <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
                </ComboboxPopup>
              </ComboboxPositioner>
            </ComboboxPortal>
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
        <ComboboxTrigger>
          <ComboboxValue placeholder="Select tool" />
        </ComboboxTrigger>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup aria-label="Workflow tool">
              <PopupSearchInput label="Search workflow tools" placeholder="Search workflow tools" />
              <GroupedToolList />
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
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
            <ComboboxValue<Option, true>>
              {(selectedValue) => (
                <React.Fragment>
                  {selectedValue?.map((item) => (
                    <ComboboxChip key={item.value}>
                      <span className="max-w-32 truncate">{item.label}</span>
                      <ComboboxChipRemove aria-label={`Remove ${item.label}`} />
                    </ComboboxChip>
                  ))}
                  <ComboboxInput
                    placeholder={selectedValue?.length ? '' : 'Assign reviewers…'}
                    className="min-w-24 px-1 py-0.5"
                  />
                </React.Fragment>
              )}
            </ComboboxValue>
          </ComboboxChips>
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
      <FieldDescription>
        Selected reviewers wrap inside the input instead of scrolling horizontally.
      </FieldDescription>
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

export const Empty: Story = {
  render: () => (
    <Field name="connector" className={fieldWidth}>
      <FieldLabel>Connector</FieldLabel>
      <Combobox items={emptyOptions} defaultInputValue="salesforce">
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <span
            aria-hidden
            className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
          />
          <ComboboxInput
            placeholder="Search connectors…"
            className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
          />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxEmpty>No connectors found</ComboboxEmpty>
              <ComboboxList<Option>>{renderSimpleOptionItem}</ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </Field>
  ),
}

export const Disabled: Story = {
  render: () => (
    <div className={fieldWidth}>
      <Combobox items={providerOptions} defaultValue={disabledProvider} disabled>
        <ComboboxLabel>Disabled provider</ComboboxLabel>
        <ComboboxTrigger>
          <ComboboxValue />
        </ComboboxTrigger>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup aria-label="Disabled provider">
              <PopupSearchInput label="Search disabled providers" placeholder="Search providers" />
              <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  ),
}

export const ReadOnly: Story = {
  render: () => (
    <Field name="readOnlySource" className={fieldWidth}>
      <FieldLabel>Read-only source</FieldLabel>
      <Combobox items={dataSourceOptions} defaultValue={readOnlyDataSource} readOnly>
        <ComboboxInputGroup className="h-8 min-h-8 px-2">
          <ComboboxInput
            placeholder="Read-only data source…"
            className="block h-4.5 grow px-1 py-0 system-sm-regular text-components-input-text-filled"
          />
          <ComboboxInputTrigger className="mr-0" />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxList<Option>>{renderOptionItem}</ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </Field>
  ),
}

const ControlledDemo = () => {
  const [value, setValue] = React.useState<Option | null>(defaultTag)

  return (
    <div className="flex w-80 flex-col items-start gap-3">
      <div className="w-full">
        <Combobox items={tagOptions} value={value} onValueChange={setValue}>
          <ComboboxLabel>Default app tag</ComboboxLabel>
          <ComboboxTrigger>
            <ComboboxValue placeholder="Select tag" />
          </ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup aria-label="Default app tag">
                <PopupSearchInput label="Search app tags" placeholder="Search tags" />
                <ComboboxList<Option>>{renderSimpleOptionItem}</ComboboxList>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>
      </div>
      <span className="rounded-md border border-divider-subtle bg-components-panel-bg px-2 py-1 system-xs-regular text-text-tertiary">
        Selected: {value?.label ?? 'None'}
      </span>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Default app tag' })
    const body = within(canvasElement.ownerDocument.body)

    await expect(canvas.getByText('Selected: Production')).toBeVisible()
    await userEvent.click(trigger)
    await userEvent.click(await body.findByRole('option', { name: 'Finance' }))

    await expect(trigger).toHaveTextContent('Finance')
    await expect(canvas.getByText('Selected: Finance')).toBeVisible()
    await waitFor(async () => {
      await expect(body.queryByRole('dialog', { name: 'Default app tag' })).not.toBeInTheDocument()
    })
  },
}
