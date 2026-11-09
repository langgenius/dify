import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagFilter } from '../components/tag-filter'
import { renderWithTags } from './render'

const { tagData } = vi.hoisted(() => ({
  tagData: { current: [] as Tag[] },
}))

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['app.tag.manage', 'dataset.tag.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

const mockTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: '' },
  { id: 'tag-3', name: 'Database', type: 'knowledge', binding_count: '' },
  { id: 'tag-4', name: 'API Design', type: 'app', binding_count: '' },
]

const defaultProps = {
  type: 'app' as const,
  value: [] as string[],
  onChange: vi.fn(),
}

const i18n = {
  placeholder: 'common.tag.placeholder',
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  operationClear: 'common.operation.clear',
  noTag: /common\.tag\.noTag/,
  manageTags: 'common.tag.manageTags',
}

const render = (ui: Parameters<typeof renderWithTags>[0]) => renderWithTags(ui, tagData.current)

describe('TagFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tagData.current = mockTags
    mockWorkspacePermissionKeys.value = ['app.tag.manage', 'dataset.tag.manage']
  })

  describe('Rendering', () => {
    it('should keep the placeholder in the trigger when no tags are selected', () => {
      render(<TagFilter {...defaultProps} />)
      expect(screen.getByText(i18n.placeholder)).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: i18n.placeholder })).toBeInTheDocument()
    })

    it('should display the count badge when multiple tags are selected', () => {
      render(<TagFilter {...defaultProps} value={['tag-1', 'tag-2']} />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('+1')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should filter tags by type prop', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} type="knowledge" />)

      await user.click(screen.getByText(i18n.placeholder))

      expect(screen.getByText('Database')).toBeInTheDocument()
      expect(screen.queryByText('Frontend')).not.toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
    })

    it('should call onChange when a tag is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} onChange={onChange} />)

      await user.click(screen.getByText(i18n.placeholder))
      await user.click(screen.getByText('Frontend'))

      expect(onChange).toHaveBeenCalledWith(['tag-1'])
    })

    it('should select the highlighted tag with keyboard navigation', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} onChange={onChange} />)

      await user.click(screen.getByText(i18n.placeholder))
      await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'Back')
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith(['tag-2'])
    })

    it('should call onChange to deselect when an already-selected tag is clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1']} onChange={onChange} />)

      await user.click(screen.getByText('Frontend'))

      const selectedTag = screen.getByRole('option', { name: /Frontend/ })
      expect(selectedTag).toHaveAttribute('aria-selected', 'true')
      await user.click(selectedTag)

      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('User Interactions', () => {
    it('should show only tags matching the type filter', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} type="app" />)

      await user.click(screen.getByText(i18n.placeholder))

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
      expect(screen.getByText('API Design')).toBeInTheDocument()
      expect(screen.queryByText('Database')).not.toBeInTheDocument()
    })

    it('should add a tag to the selection', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1']} onChange={onChange} />)

      await user.click(screen.getByText('Frontend'))
      await user.click(screen.getByRole('option', { name: /Backend/ }))

      expect(onChange).toHaveBeenCalledWith(['tag-1', 'tag-2'])
    })

    it('should clear all selected tags when clear button is clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<TagFilter {...defaultProps} value={['tag-1', 'tag-2']} onChange={onChange} />)

      const clearButton = screen.getByRole('button', { name: i18n.operationClear })
      expect(clearButton).toBeInTheDocument()
      await user.click(clearButton)

      expect(onChange).toHaveBeenCalledWith([])
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('should open manage tags modal and close dropdown', async () => {
      const user = userEvent.setup()
      const onOpenTagManagement = vi.fn()
      render(<TagFilter {...defaultProps} onOpenTagManagement={onOpenTagManagement} />)

      await user.click(screen.getByText(i18n.placeholder))
      await user.click(screen.getByText(i18n.manageTags))

      expect(onOpenTagManagement).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    })

    it('should expose popup actions after the combobox in keyboard order', async () => {
      const user = userEvent.setup()
      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const input = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
      const manageButton = screen.getByRole('button', { name: i18n.manageTags })
      const listbox = screen.getByRole('listbox')

      expect(screen.getByRole('dialog', { name: i18n.placeholder })).toBeInTheDocument()
      expect(listbox).not.toContainElement(manageButton)
      await waitFor(() => expect(input).toHaveFocus())

      await user.tab()
      expect(manageButton).toHaveFocus()
    })

    it('should hide tag management action without tag management permission', async () => {
      const user = userEvent.setup()
      mockWorkspacePermissionKeys.value = []

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      expect(screen.queryByRole('button', { name: i18n.manageTags })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: /Frontend/i })).toBeInTheDocument()
    })
  })

  describe('Search', () => {
    it('should filter tags by search keywords', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
      await user.type(searchInput, 'front')

      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.queryByText('Backend')).not.toBeInTheDocument()
      expect(screen.queryByText('API Design')).not.toBeInTheDocument()
    })

    it('should keep search input focused when search has no results', async () => {
      const user = userEvent.setup()

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      const searchInput = screen.getByRole('combobox', { name: i18n.selectorPlaceholder })
      await user.type(searchInput, 'NonExistentTag')

      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
      expect(searchInput).toHaveFocus()
    })
  })

  describe('Edge Cases', () => {
    it('should show no tag message when tag list is completely empty', async () => {
      const user = userEvent.setup()
      tagData.current = []

      render(<TagFilter {...defaultProps} />)

      await user.click(screen.getByText(i18n.placeholder))

      expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    })

    it('should name and preserve selected tag ids outside the current result set', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const selectedCountLabel = 'common.dynamicSelect.selected:{"count":1}'

      render(<TagFilter {...defaultProps} value={['non-existent-id']} onChange={onChange} />)

      const trigger = screen.getByRole('combobox', { name: selectedCountLabel })
      expect(trigger).toHaveTextContent(selectedCountLabel)

      await user.click(trigger)
      await user.click(screen.getByRole('option', { name: /Frontend/i }))

      expect(onChange).toHaveBeenCalledWith(['non-existent-id', 'tag-1'])
    })
  })
})
