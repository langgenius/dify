import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { TagComboboxItem } from '../components/tag-combobox-item'
import { Combobox } from '@langgenius/dify-ui/combobox'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState } from 'react'
import { isCreateTagOption } from '../components/tag-combobox-item'
import { TagSearchContent } from '../components/tag-search-content'

const { onValueChangeSpy } = vi.hoisted(() => ({
  onValueChangeSpy: vi.fn(),
}))

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['app.tag.manage', 'dataset.tag.manage'] as string[],
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

const i18n = {
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  operationClear: 'common.operation.clear',
  create: 'common.tag.create',
  noTag: /common\.tag\.noTag/,
  manageTags: 'common.tag.manageTags',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: '' },
  { id: 'tag-3', name: 'API', type: 'app', binding_count: '' },
]

const knowledgeTag: Tag = { id: 'tag-k1', name: 'KnowledgeDB', type: 'knowledge', binding_count: '' }

type PanelHarnessProps = {
  type?: TagType
  value?: Tag[]
  tagList?: Tag[]
  canBindOrUnbindTags?: boolean
  onOpenTagManagement?: () => void
}

const tagToString = (tag: TagComboboxItem) => tag.name
const isSameTag = (item: TagComboboxItem, value: TagComboboxItem) => item.id === value.id
const tagFilter = (tag: TagComboboxItem, query: string) => tag.name.includes(query)

const PanelHarness = ({
  type = 'app',
  value = [appTags[0]!],
  tagList = [...appTags, knowledgeTag],
  canBindOrUnbindTags,
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
      binding_count: '',
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
      <TagSearchContent
        type={type}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        canBindOrUnbindTags={canBindOrUnbindTags}
        onOpenTagManagement={onOpenTagManagement}
      />
    </Combobox>
  )
}

describe('TagSearchContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['app.tag.manage', 'dataset.tag.manage']
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

  it('clears only the search input from the input clear button', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    const input = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
    await user.type(input, 'Back')
    expect(input).toHaveValue('Back')
    vi.clearAllMocks()

    await user.click(screen.getByRole('button', { name: i18n.operationClear }))

    expect(input).toHaveValue('')
    expect(onValueChangeSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /Frontend/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a create option when the query is not an existing tag name', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'BrandNewTag')

    const createOption = screen.getByRole('option', { name: /BrandNewTag/i })
    expect(createOption).toHaveTextContent(i18n.create)
    expect(createOption).toHaveTextContent('BrandNewTag')
  })

  it('does not show a create option for an exact existing tag name', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'Frontend')

    expect(screen.queryByRole('option', { name: /common\.tag\.create/i })).not.toBeInTheDocument()
  })

  it('updates only the combobox draft value when selecting and deselecting options', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.click(screen.getByRole('option', { name: /Backend/i }))
    expect(onValueChangeSpy).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'tag-2' })]))

    await user.click(screen.getByRole('option', { name: /Backend/i }))
    expect(onValueChangeSpy).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'tag-1' })])
  })

  it('routes create option activation through the combobox value change API', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    const input = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
    await user.type(input, 'BrandNewTag')
    await user.click(screen.getByRole('option', { name: /BrandNewTag/i }))

    expect(onValueChangeSpy).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({
        isCreateOption: true,
        name: 'BrandNewTag',
      }),
    ]))
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

  it('hides tag management action without tag management permission', () => {
    mockWorkspacePermissionKeys.value = []

    render(<PanelHarness />)

    expect(screen.queryByRole('button', { name: i18n.manageTags })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Frontend/i })).toBeInTheDocument()
  })

  it('does not update selection when neither tag management nor binding permission is available', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = []

    render(<PanelHarness />)

    await user.click(screen.getByRole('option', { name: /Backend/i }))

    expect(onValueChangeSpy).not.toHaveBeenCalled()
  })

  it('updates selection with binding capability without tag management permission', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = []

    render(<PanelHarness canBindOrUnbindTags />)

    await user.click(screen.getByRole('option', { name: /Backend/i }))

    expect(onValueChangeSpy).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'tag-2' }),
    ]))
    expect(screen.queryByRole('button', { name: i18n.manageTags })).not.toBeInTheDocument()
  })

  it('renders knowledge tags when the panel type is knowledge', () => {
    render(<PanelHarness type="knowledge" value={[]} />)
    expect(screen.getByRole('option', { name: /KnowledgeDB/i })).toBeInTheDocument()
  })

  it('renders snippet management action with snippets create-and-modify permission', () => {
    mockWorkspacePermissionKeys.value = ['snippets.create_and_modify']

    render(
      <PanelHarness
        type="snippet"
        value={[]}
        tagList={[{ id: 'snippet-tag-1', name: 'Reusable', type: 'snippet', binding_count: '' }]}
      />,
    )

    expect(screen.getByRole('button', { name: i18n.manageTags })).toBeInTheDocument()
  })
})
