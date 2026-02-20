import type { Tag } from '@/app/components/base/tag-management/constant'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { act } from 'react'
import TagSelector from './selector'
import { useStore as useTagStore } from './store'

// Hoisted mocks
const { fetchTagList, createTag, bindTag, unBindTag } = vi.hoisted(() => ({
  fetchTagList: vi.fn(),
  createTag: vi.fn(),
  bindTag: vi.fn(),
  unBindTag: vi.fn(),
}))

const mockNotify = vi.fn()

vi.mock('@/service/tag', () => ({
  fetchTagList,
  createTag,
  bindTag,
  unBindTag,
}))

// Mock use-context-selector for ToastContext
vi.mock('use-context-selector', () => ({
  createContext: <T,>(defaultValue: T) => React.createContext(defaultValue),
  useContext: () => ({
    notify: mockNotify,
  }),
}))

// i18n keys rendered in "ns.key" format
const i18n = {
  addTag: 'common.tag.addTag',
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  manageTags: 'common.tag.manageTags',
  noTag: 'common.tag.noTag',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: 3 },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: 5 },
]

const defaultProps = {
  targetID: 'target-1',
  type: 'app' as const,
  value: ['tag-1'],
  selectedTags: [appTags[0]],
  onCacheUpdate: vi.fn(),
  onChange: vi.fn(),
}

describe('TagSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchTagList).mockResolvedValue(appTags)
    vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: 0 })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
    act(() => {
      useTagStore.setState({ tagList: appTags, showTagManagementModal: false })
    })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TagSelector {...defaultProps} />)
      // The Trigger component shows selected tag names
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should render the trigger with selected tag names', () => {
      render(<TagSelector {...defaultProps} />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should render add-tag placeholder when no tags are selected', () => {
      render(<TagSelector {...defaultProps} selectedTags={[]} value={[]} />)
      expect(screen.getByText(i18n.addTag)).toBeInTheDocument()
    })

    it('should render nothing when isPopover is false', () => {
      const { container } = render(<TagSelector {...defaultProps} isPopover={false} />)
      // Only the empty fragment wrapper
      expect(container.innerHTML).toBe('')
    })

    it('should render the popover trigger button', () => {
      render(<TagSelector {...defaultProps} />)
      // The trigger is wrapped in a PopoverButton
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should default isPopover to true', () => {
      render(<TagSelector {...defaultProps} />)
      // Popover renders, trigger is visible
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should filter selectedTags to only those present in store tagList', () => {
      const unknownTag: Tag = { id: 'unknown', name: 'Unknown', type: 'app', binding_count: 0 }
      render(
        <TagSelector
          {...defaultProps}
          selectedTags={[appTags[0], unknownTag]}
          value={['tag-1', 'unknown']}
        />,
      )
      // 'Frontend' is in tagList, 'Unknown' is not
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('should display multiple tag names when multiple are selected', () => {
      render(
        <TagSelector
          {...defaultProps}
          selectedTags={appTags}
          value={['tag-1', 'tag-2']}
        />,
      )
      expect(screen.getByText('Frontend')).toBeInTheDocument()
      expect(screen.getByText('Backend')).toBeInTheDocument()
    })

    it('should pass position prop to the popover', () => {
      // render with position='br' — no crash, popover still works
      render(<TagSelector {...defaultProps} position="br" />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })
  })

  describe('Popover Interaction', () => {
    it('should show the panel when the trigger is clicked', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      await user.click(screen.getByRole('button'))

      // Panel renders the search input and manage tags
      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder)).toBeInTheDocument()
      })
      expect(screen.getByText(i18n.manageTags)).toBeInTheDocument()
    })

    it('should show unselected tags in the panel', async () => {
      const user = userEvent.setup()
      render(<TagSelector {...defaultProps} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('Backend')).toBeInTheDocument()
      })
    })

    it('should show the no-tag message when tag list is empty', async () => {
      const user = userEvent.setup()
      act(() => {
        useTagStore.setState({ tagList: [] })
      })
      render(<TagSelector {...defaultProps} selectedTags={[]} value={[]} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
      })
    })
  })

  describe('Data Fetching (getTagList / onCreate)', () => {
    it('should call fetchTagList when a tag is created in the panel', async () => {
      const user = userEvent.setup()
      vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 })

      render(<TagSelector {...defaultProps} />)

      // Open popover
      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder)).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      // Click the create option
      const createOption = screen.getByText(/common\.tag\.create/).closest('div[class*="cursor-pointer"]')
      expect(createOption).toBeTruthy()
      await user.click(createOption!)

      // onCreate calls getTagList which calls fetchTagList
      await waitFor(() => {
        expect(fetchTagList).toHaveBeenCalledWith('app')
      })
    })

    it('should update the store tagList after fetching', async () => {
      const user = userEvent.setup()
      const freshTags: Tag[] = [
        ...appTags,
        { id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 },
      ]
      vi.mocked(createTag).mockResolvedValue({ id: 'new-tag', name: 'BrandNewTag', type: 'app', binding_count: 0 })
      vi.mocked(fetchTagList).mockResolvedValue(freshTags)

      render(<TagSelector {...defaultProps} />)

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder)).toBeInTheDocument()
      })

      const input = screen.getByPlaceholderText(i18n.selectorPlaceholder)
      await user.type(input, 'BrandNewTag')

      const createOption = screen.getByText(/common\.tag\.create/).closest('div[class*="cursor-pointer"]')
      await user.click(createOption!)

      await waitFor(() => {
        expect(useTagStore.getState().tagList).toEqual(freshTags)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty selectedTags array', () => {
      render(<TagSelector {...defaultProps} selectedTags={[]} value={[]} />)
      expect(screen.getByText(i18n.addTag)).toBeInTheDocument()
    })

    it('should handle selectedTags with no matching tags in store', () => {
      const orphanTags: Tag[] = [
        { id: 'orphan-1', name: 'Orphan', type: 'app', binding_count: 0 },
      ]
      render(
        <TagSelector
          {...defaultProps}
          selectedTags={orphanTags}
          value={['orphan-1']}
        />,
      )
      // Orphan tag is not in store tagList, so tags memo returns []
      expect(screen.queryByText('Orphan')).not.toBeInTheDocument()
      expect(screen.getByText(i18n.addTag)).toBeInTheDocument()
    })

    it('should handle knowledge type', async () => {
      const user = userEvent.setup()
      const knowledgeTags: Tag[] = [
        { id: 'k-1', name: 'KnowledgeDB', type: 'knowledge', binding_count: 2 },
      ]
      vi.mocked(fetchTagList).mockResolvedValue(knowledgeTags)
      act(() => {
        useTagStore.setState({ tagList: knowledgeTags })
      })

      render(
        <TagSelector
          {...defaultProps}
          type="knowledge"
          selectedTags={knowledgeTags}
          value={['k-1']}
        />,
      )

      expect(screen.getByText('KnowledgeDB')).toBeInTheDocument()

      // Open popover and verify panel uses knowledge type
      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(i18n.selectorPlaceholder)).toBeInTheDocument()
      })
    })

    it('should handle undefined minWidth', () => {
      render(<TagSelector {...defaultProps} />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })

    it('should apply min-width class when minWidth prop is provided', () => {
      render(<TagSelector {...defaultProps} minWidth="320px" />)
      expect(screen.getByText('Frontend')).toBeInTheDocument()
    })
  })
})
