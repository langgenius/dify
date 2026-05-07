import type { TagComboboxItem } from '../components/tag-combobox-item'
import type { Tag, TagType } from '@/contract/console/tags'
import { Combobox } from '@langgenius/dify-ui/combobox'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState } from 'react'
import { isCreateTagOption } from '../components/tag-combobox-item'
import { TagPanel } from '../components/tag-panel'

const { mockNotify, mockToast } = vi.hoisted(() => {
  const mockNotify = vi.fn()
  const mockToast = Object.assign(mockNotify, {
    success: vi.fn((message, options) => mockNotify({ type: 'success', message, ...options })),
    error: vi.fn((message, options) => mockNotify({ type: 'error', message, ...options })),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockNotify, mockToast }
})

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: mockToast }))

const { createTag, onValueChangeSpy } = vi.hoisted(() => ({
  createTag: vi.fn(),
  onValueChangeSpy: vi.fn(),
}))

vi.mock('../hooks/use-tag-mutations', () => ({
  useCreateTagMutation: () => ({
    isPending: false,
    mutate: ({ body }: { body: { name: string, type: TagType } }, options?: { onSuccess?: (tag: Tag) => void, onError?: () => void }) => {
      const tag: Tag = { id: 'new-tag', name: body.name, type: body.type, binding_count: 0 }
      Promise.resolve(createTag(body.name, body.type))
        .then(() => options?.onSuccess?.(tag))
        .catch(() => options?.onError?.())
    },
  }),
}))

const i18n = {
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  create: 'common.tag.create',
  created: 'common.tag.created',
  failed: 'common.tag.failed',
  noTag: 'common.tag.noTag',
  manageTags: 'common.tag.manageTags',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
  { id: 'tag-3', name: 'API', type: 'app', binding_count: 1 },
]

const knowledgeTag: Tag = { id: 'tag-k1', name: 'KnowledgeDB', type: 'knowledge', binding_count: 2 }

type PanelHarnessProps = {
  type?: TagType
  value?: Tag[]
  tagList?: Tag[]
  onOpenTagManagement?: () => void
}

const tagToString = (tag: TagComboboxItem) => tag.name
const isSameTag = (item: TagComboboxItem, value: TagComboboxItem) => item.id === value.id
const tagFilter = (tag: TagComboboxItem, query: string) => tag.name.includes(query)

const PanelHarness = ({
  type = 'app',
  value = [appTags[0]!],
  tagList = [...appTags, knowledgeTag],
  onOpenTagManagement,
}: PanelHarnessProps) => {
  const [selectedTags, setSelectedTags] = useState<Tag[]>(value)
  const [inputValue, setInputValue] = useState('')
  const items = useMemo<TagComboboxItem[]>(() => {
    const tags = tagList.filter(tag => tag.type === type)

    if (!inputValue || tags.some(tag => tag.name === inputValue))
      return tags

    return [{
      id: `__create_tag__:${inputValue}`,
      name: inputValue,
      type,
      binding_count: 0,
      isCreateOption: true,
    }, ...tags]
  }, [inputValue, tagList, type])

  return (
    <Combobox
      items={items}
      multiple
      value={selectedTags}
      onValueChange={(nextTags) => {
        onValueChangeSpy(nextTags)
        if (nextTags.some(isCreateTagOption))
          return
        setSelectedTags(nextTags)
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      filter={tagFilter}
      itemToStringLabel={tagToString}
      isItemEqualToValue={isSameTag}
    >
      <TagPanel
        type={type}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        onOpenTagManagement={onOpenTagManagement}
      />
    </Combobox>
  )
}

describe('TagPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
  })

  it('renders search, selected tags, unselected tags, and management action', () => {
    render(<PanelHarness />)

    expect(screen.getByRole('combobox', { name: i18n.selectorPlaceholder })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Frontend/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Backend/i })).toBeInTheDocument()
    expect(screen.queryByText('KnowledgeDB')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.manageTags })).toBeInTheDocument()
  })

  it('filters options by the controlled combobox input value', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'Back')

    expect(screen.getByRole('option', { name: /Backend/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /API/i })).not.toBeInTheDocument()
  })

  it('shows a create option when the query is not an existing tag name', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'BrandNewTag')

    expect(screen.getByTestId('create-tag-option')).toHaveTextContent(i18n.create)
    expect(screen.getByTestId('create-tag-option')).toHaveTextContent('BrandNewTag')
  })

  it('does not show a create option for an exact existing tag name', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'Frontend')

    expect(screen.queryByTestId('create-tag-option')).not.toBeInTheDocument()
  })

  it('updates only the combobox draft value when selecting and deselecting options', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.click(screen.getByRole('option', { name: /Backend/i }))
    expect(onValueChangeSpy).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'tag-2' })]))

    await user.click(screen.getByRole('option', { name: /Backend/i }))
    expect(onValueChangeSpy).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'tag-1' })])
  })

  it('creates a tag without selecting it and clears the search value on success', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    const input = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
    await user.type(input, 'BrandNewTag')
    await user.click(screen.getByTestId('create-tag-option'))

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledWith('BrandNewTag', 'app')
    })
    expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: i18n.created })
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('shows an error notification when tag creation fails', async () => {
    const user = userEvent.setup()
    vi.mocked(createTag).mockRejectedValueOnce(new Error('Creation failed'))
    render(<PanelHarness />)

    await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'FailTag')
    await user.click(screen.getByTestId('create-tag-option'))

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: i18n.failed })
    })
  })

  it('renders the empty state when no tags exist and no search is active', () => {
    render(<PanelHarness value={[]} tagList={[]} />)
    expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
  })

  it('opens tag management through a semantic button', async () => {
    const user = userEvent.setup()
    const onOpenTagManagement = vi.fn()
    render(<PanelHarness onOpenTagManagement={onOpenTagManagement} />)

    await user.click(screen.getByRole('button', { name: i18n.manageTags }))

    expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
  })

  it('renders knowledge tags when the panel type is knowledge', () => {
    render(<PanelHarness type="knowledge" value={[]} />)
    expect(screen.getByRole('option', { name: /KnowledgeDB/i })).toBeInTheDocument()
  })
})
