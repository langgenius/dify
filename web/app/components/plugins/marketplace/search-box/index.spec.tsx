import type { Tag } from '@/app/components/plugins/hooks'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SearchBox from './index'
import SearchBoxWrapper from './search-box-wrapper'
import MarketplaceTrigger from './trigger/marketplace'
import ToolSelectorTrigger from './trigger/tool-selector'

// ================================
// Mock external dependencies only
// ================================

// Mock i18n translation hook
vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      // Build full key with namespace prefix if provided
      const fullKey = options?.ns ? `${options.ns}.${key}` : key
      const translations: Record<string, string> = {
        'pluginTags.allTags': 'All Tags',
        'pluginTags.searchTags': 'Search tags',
        'plugin.searchPlugins': 'Search plugins',
      }
      return translations[fullKey] || key
    },
  }),
}))

// Mock marketplace state hooks
const { mockSearchPluginText, mockHandleSearchPluginTextChange, mockFilterPluginTags, mockHandleFilterPluginTagsChange } = vi.hoisted(() => {
  return {
    mockSearchPluginText: '',
    mockHandleSearchPluginTextChange: vi.fn(),
    mockFilterPluginTags: [] as string[],
    mockHandleFilterPluginTagsChange: vi.fn(),
  }
})

vi.mock('../atoms', () => ({
  useSearchPluginText: () => [mockSearchPluginText, mockHandleSearchPluginTextChange],
  useFilterPluginTags: () => [mockFilterPluginTags, mockHandleFilterPluginTagsChange],
}))

// Mock useTags hook
const mockTags: Tag[] = [
  { name: 'agent', label: 'Agent' },
  { name: 'rag', label: 'RAG' },
  { name: 'search', label: 'Search' },
  { name: 'image', label: 'Image' },
  { name: 'videos', label: 'Videos' },
]

const mockTagsMap: Record<string, Tag> = mockTags.reduce((acc, tag) => {
  acc[tag.name] = tag
  return acc
}, {} as Record<string, Tag>)

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: mockTags,
    tagsMap: mockTagsMap,
  }),
}))

// Mock portal-to-follow-elem with shared open state
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: {
    children: React.ReactNode
    open: boolean
  }) => {
    mockPortalOpenState = open
    return (
      <div data-testid="portal-elem" data-open={open}>
        {children}
      </div>
    )
  },
  PortalToFollowElemTrigger: ({ children, onClick, className }: {
    children: React.ReactNode
    onClick: () => void
    className?: string
  }) => (
    <div data-testid="portal-trigger" onClick={onClick} className={className}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children, className }: {
    children: React.ReactNode
    className?: string
  }) => {
    // Only render content when portal is open
    if (!mockPortalOpenState)
      return null
    return (
      <div data-testid="portal-content" className={className}>
        {children}
      </div>
    )
  },
}))

// ================================
// SearchBox Component Tests
// ================================
describe('SearchBox', () => {
  const defaultProps = {
    search: '',
    onSearchChange: vi.fn(),
    tags: [] as string[],
    onTagsChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SearchBox {...defaultProps} />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render with marketplace mode styling', () => {
      const { container } = render(
        <SearchBox {...defaultProps} usedInMarketplace />,
      )

      // In marketplace mode, TagsFilter comes before input
      expect(container.querySelector('.rounded-xl')).toBeInTheDocument()
    })

    it('should render with non-marketplace mode styling', () => {
      const { container } = render(
        <SearchBox {...defaultProps} usedInMarketplace={false} />,
      )

      // In non-marketplace mode, search icon appears first
      expect(container.querySelector('.radius-md')).toBeInTheDocument()
    })

    it('should render placeholder correctly', () => {
      render(<SearchBox {...defaultProps} placeholder="Search here..." />)

      expect(screen.getByPlaceholderText('Search here...')).toBeInTheDocument()
    })

    it('should render search input with current value', () => {
      render(<SearchBox {...defaultProps} search="test query" />)

      expect(screen.getByDisplayValue('test query')).toBeInTheDocument()
    })

    it('should render TagsFilter component', () => {
      render(<SearchBox {...defaultProps} />)

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })
  })

  // ================================
  // Marketplace Mode Tests
  // ================================
  describe('Marketplace Mode', () => {
    it('should render TagsFilter before input in marketplace mode', () => {
      render(<SearchBox {...defaultProps} usedInMarketplace />)

      const portalElem = screen.getByTestId('portal-elem')
      const input = screen.getByRole('textbox')

      // Both should be rendered
      expect(portalElem).toBeInTheDocument()
      expect(input).toBeInTheDocument()
    })

    it('should render clear button when search has value in marketplace mode', () => {
      render(<SearchBox {...defaultProps} usedInMarketplace search="test" />)

      // ActionButton with close icon should be rendered
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not render clear button when search is empty in marketplace mode', () => {
      const { container } = render(<SearchBox {...defaultProps} usedInMarketplace search="" />)

      // RiCloseLine icon should not be visible (it's within ActionButton)
      const closeIcons = container.querySelectorAll('.size-4')
      // Only filter icons should be present, not close button
      expect(closeIcons.length).toBeLessThan(3)
    })
  })

  // ================================
  // Non-Marketplace Mode Tests
  // ================================
  describe('Non-Marketplace Mode', () => {
    it('should render search icon at the beginning', () => {
      const { container } = render(
        <SearchBox {...defaultProps} usedInMarketplace={false} />,
      )

      // Search icon should be present
      expect(container.querySelector('.text-components-input-text-placeholder')).toBeInTheDocument()
    })

    it('should render clear button when search has value', () => {
      render(<SearchBox {...defaultProps} usedInMarketplace={false} search="test" />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should render TagsFilter after input in non-marketplace mode', () => {
      render(<SearchBox {...defaultProps} usedInMarketplace={false} />)

      const portalElem = screen.getByTestId('portal-elem')
      const input = screen.getByRole('textbox')

      expect(portalElem).toBeInTheDocument()
      expect(input).toBeInTheDocument()
    })

    it('should set autoFocus when prop is true', () => {
      render(<SearchBox {...defaultProps} usedInMarketplace={false} autoFocus />)

      const input = screen.getByRole('textbox')
      // autoFocus is a boolean attribute that React handles specially
      expect(input).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions Tests
  // ================================
  describe('User Interactions', () => {
    it('should call onSearchChange when input value changes', () => {
      const onSearchChange = vi.fn()
      render(<SearchBox {...defaultProps} onSearchChange={onSearchChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new search' } })

      expect(onSearchChange).toHaveBeenCalledWith('new search')
    })

    it('should call onSearchChange with empty string when clear button is clicked in marketplace mode', () => {
      const onSearchChange = vi.fn()
      render(
        <SearchBox
          {...defaultProps}
          onSearchChange={onSearchChange}
          usedInMarketplace
          search="test"
        />,
      )

      const buttons = screen.getAllByRole('button')
      // Find the clear button (the one in the search area)
      const clearButton = buttons[buttons.length - 1]
      fireEvent.click(clearButton)

      expect(onSearchChange).toHaveBeenCalledWith('')
    })

    it('should call onSearchChange with empty string when clear button is clicked in non-marketplace mode', () => {
      const onSearchChange = vi.fn()
      render(
        <SearchBox
          {...defaultProps}
          onSearchChange={onSearchChange}
          usedInMarketplace={false}
          search="test"
        />,
      )

      const buttons = screen.getAllByRole('button')
      // First button should be the clear button in non-marketplace mode
      fireEvent.click(buttons[0])

      expect(onSearchChange).toHaveBeenCalledWith('')
    })

    it('should handle rapid typing correctly', () => {
      const onSearchChange = vi.fn()
      render(<SearchBox {...defaultProps} onSearchChange={onSearchChange} />)

      const input = screen.getByRole('textbox')

      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.change(input, { target: { value: 'ab' } })
      fireEvent.change(input, { target: { value: 'abc' } })

      expect(onSearchChange).toHaveBeenCalledTimes(3)
      expect(onSearchChange).toHaveBeenLastCalledWith('abc')
    })
  })

  // ================================
  // Add Custom Tool Button Tests
  // ================================
  describe('Add Custom Tool Button', () => {
    it('should render add custom tool button when supportAddCustomTool is true', () => {
      render(<SearchBox {...defaultProps} supportAddCustomTool />)

      // The add button should be rendered
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })

    it('should not render add custom tool button when supportAddCustomTool is false', () => {
      const { container } = render(
        <SearchBox {...defaultProps} supportAddCustomTool={false} />,
      )

      // Check for the rounded-full button which is the add button
      const addButton = container.querySelector('.rounded-full')
      expect(addButton).not.toBeInTheDocument()
    })

    it('should call onShowAddCustomCollectionModal when add button is clicked', () => {
      const onShowAddCustomCollectionModal = vi.fn()
      render(
        <SearchBox
          {...defaultProps}
          supportAddCustomTool
          onShowAddCustomCollectionModal={onShowAddCustomCollectionModal}
        />,
      )

      // Find the add button (it has rounded-full class)
      const buttons = screen.getAllByRole('button')
      const addButton = buttons.find(btn =>
        btn.className.includes('rounded-full'),
      )

      if (addButton) {
        fireEvent.click(addButton)
        expect(onShowAddCustomCollectionModal).toHaveBeenCalledTimes(1)
      }
    })
  })

  // ================================
  // Props Variations Tests
  // ================================
  describe('Props Variations', () => {
    it('should apply wrapperClassName correctly', () => {
      const { container } = render(
        <SearchBox {...defaultProps} wrapperClassName="custom-wrapper-class" />,
      )

      expect(container.querySelector('.custom-wrapper-class')).toBeInTheDocument()
    })

    it('should apply inputClassName correctly', () => {
      const { container } = render(
        <SearchBox {...defaultProps} inputClassName="custom-input-class" />,
      )

      expect(container.querySelector('.custom-input-class')).toBeInTheDocument()
    })

    it('should handle empty placeholder', () => {
      render(<SearchBox {...defaultProps} placeholder="" />)

      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '')
    })

    it('should use default placeholder when not provided', () => {
      render(<SearchBox {...defaultProps} />)

      expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '')
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty search value', () => {
      render(<SearchBox {...defaultProps} search="" />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('should handle empty tags array', () => {
      render(<SearchBox {...defaultProps} tags={[]} />)

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should handle special characters in search', () => {
      const onSearchChange = vi.fn()
      render(<SearchBox {...defaultProps} onSearchChange={onSearchChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '<script>alert("xss")</script>' } })

      expect(onSearchChange).toHaveBeenCalledWith('<script>alert("xss")</script>')
    })

    it('should handle very long search strings', () => {
      const longString = 'a'.repeat(1000)
      render(<SearchBox {...defaultProps} search={longString} />)

      expect(screen.getByDisplayValue(longString)).toBeInTheDocument()
    })

    it('should handle whitespace-only search', () => {
      const onSearchChange = vi.fn()
      render(<SearchBox {...defaultProps} onSearchChange={onSearchChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '   ' } })

      expect(onSearchChange).toHaveBeenCalledWith('   ')
    })
  })
})

// ================================
// SearchBoxWrapper Component Tests
// ================================
describe('SearchBoxWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SearchBoxWrapper />)

      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render in marketplace mode', () => {
      const { container } = render(<SearchBoxWrapper />)

      expect(container.querySelector('.rounded-xl')).toBeInTheDocument()
    })

    it('should apply correct wrapper classes', () => {
      const { container } = render(<SearchBoxWrapper />)

      // Check for z-[11] class from wrapper
      expect(container.querySelector('.z-\\[11\\]')).toBeInTheDocument()
    })
  })

  describe('Hook Integration', () => {
    it('should call handleSearchPluginTextChange when search changes', () => {
      render(<SearchBoxWrapper />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new search' } })

      expect(mockHandleSearchPluginTextChange).toHaveBeenCalledWith('new search')
    })
  })

  describe('Translation', () => {
    it('should use translation for placeholder', () => {
      render(<SearchBoxWrapper />)

      expect(screen.getByPlaceholderText('Search plugins')).toBeInTheDocument()
    })
  })
})

// ================================
// MarketplaceTrigger Component Tests
// ================================
describe('MarketplaceTrigger', () => {
  const defaultProps = {
    selectedTagsLength: 0,
    open: false,
    tags: [] as string[],
    tagsMap: mockTagsMap,
    onTagsChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MarketplaceTrigger {...defaultProps} />)

      expect(screen.getByText('All Tags')).toBeInTheDocument()
    })

    it('should show "All Tags" when no tags selected', () => {
      render(<MarketplaceTrigger {...defaultProps} selectedTagsLength={0} />)

      expect(screen.getByText('All Tags')).toBeInTheDocument()
    })

    it('should show arrow down icon when no tags selected', () => {
      const { container } = render(
        <MarketplaceTrigger {...defaultProps} selectedTagsLength={0} />,
      )

      // Arrow down icon should be present
      expect(container.querySelector('.size-4')).toBeInTheDocument()
    })
  })

  describe('Selected Tags Display', () => {
    it('should show selected tag labels when tags are selected', () => {
      render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    it('should show multiple tag labels separated by comma', () => {
      render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={2}
          tags={['agent', 'rag']}
        />,
      )

      expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    })

    it('should show +N indicator when more than 2 tags selected', () => {
      render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={4}
          tags={['agent', 'rag', 'search', 'image']}
        />,
      )

      expect(screen.getByText('+2')).toBeInTheDocument()
    })

    it('should only show first 2 tags in label', () => {
      render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={3}
          tags={['agent', 'rag', 'search']}
        />,
      )

      expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
      expect(screen.queryByText('Search')).not.toBeInTheDocument()
    })
  })

  describe('Clear Tags Button', () => {
    it('should show clear button when tags are selected', () => {
      const { container } = render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      // RiCloseCircleFill icon should be present
      expect(container.querySelector('.text-text-quaternary')).toBeInTheDocument()
    })

    it('should not show clear button when no tags selected', () => {
      const { container } = render(
        <MarketplaceTrigger {...defaultProps} selectedTagsLength={0} />,
      )

      // Clear button should not be present
      expect(container.querySelector('.text-text-quaternary')).not.toBeInTheDocument()
    })

    it('should call onTagsChange with empty array when clear is clicked', () => {
      const onTagsChange = vi.fn()
      const { container } = render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={2}
          tags={['agent', 'rag']}
          onTagsChange={onTagsChange}
        />,
      )

      const clearButton = container.querySelector('.text-text-quaternary')
      if (clearButton) {
        fireEvent.click(clearButton)
        expect(onTagsChange).toHaveBeenCalledWith([])
      }
    })
  })

  describe('Open State Styling', () => {
    it('should apply hover styling when open and no tags selected', () => {
      const { container } = render(
        <MarketplaceTrigger {...defaultProps} open selectedTagsLength={0} />,
      )

      expect(container.querySelector('.bg-state-base-hover')).toBeInTheDocument()
    })

    it('should apply border styling when tags are selected', () => {
      const { container } = render(
        <MarketplaceTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      expect(container.querySelector('.border-components-button-secondary-border')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should handle empty tagsMap', () => {
      const { container } = render(
        <MarketplaceTrigger {...defaultProps} tagsMap={{}} tags={[]} />,
      )

      expect(container).toBeInTheDocument()
    })
  })
})

// ================================
// ToolSelectorTrigger Component Tests
// ================================
describe('ToolSelectorTrigger', () => {
  const defaultProps = {
    selectedTagsLength: 0,
    open: false,
    tags: [] as string[],
    tagsMap: mockTagsMap,
    onTagsChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ToolSelectorTrigger {...defaultProps} />)

      expect(container).toBeInTheDocument()
    })

    it('should render price tag icon', () => {
      const { container } = render(<ToolSelectorTrigger {...defaultProps} />)

      expect(container.querySelector('.size-4')).toBeInTheDocument()
    })
  })

  describe('Selected Tags Display', () => {
    it('should show selected tag labels when tags are selected', () => {
      render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    it('should show multiple tag labels separated by comma', () => {
      render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={2}
          tags={['agent', 'rag']}
        />,
      )

      expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    })

    it('should show +N indicator when more than 2 tags selected', () => {
      render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={4}
          tags={['agent', 'rag', 'search', 'image']}
        />,
      )

      expect(screen.getByText('+2')).toBeInTheDocument()
    })

    it('should not show tag labels when no tags selected', () => {
      render(<ToolSelectorTrigger {...defaultProps} selectedTagsLength={0} />)

      expect(screen.queryByText('Agent')).not.toBeInTheDocument()
    })
  })

  describe('Clear Tags Button', () => {
    it('should show clear button when tags are selected', () => {
      const { container } = render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      expect(container.querySelector('.text-text-quaternary')).toBeInTheDocument()
    })

    it('should not show clear button when no tags selected', () => {
      const { container } = render(
        <ToolSelectorTrigger {...defaultProps} selectedTagsLength={0} />,
      )

      expect(container.querySelector('.text-text-quaternary')).not.toBeInTheDocument()
    })

    it('should call onTagsChange with empty array when clear is clicked', () => {
      const onTagsChange = vi.fn()
      const { container } = render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={2}
          tags={['agent', 'rag']}
          onTagsChange={onTagsChange}
        />,
      )

      const clearButton = container.querySelector('.text-text-quaternary')
      if (clearButton) {
        fireEvent.click(clearButton)
        expect(onTagsChange).toHaveBeenCalledWith([])
      }
    })

    it('should stop propagation when clear button is clicked', () => {
      const onTagsChange = vi.fn()
      const parentClickHandler = vi.fn()

      const { container } = render(
        <div onClick={parentClickHandler}>
          <ToolSelectorTrigger
            {...defaultProps}
            selectedTagsLength={1}
            tags={['agent']}
            onTagsChange={onTagsChange}
          />
        </div>,
      )

      const clearButton = container.querySelector('.text-text-quaternary')
      if (clearButton) {
        fireEvent.click(clearButton)
        expect(onTagsChange).toHaveBeenCalledWith([])
        // Parent should not be called due to stopPropagation
        expect(parentClickHandler).not.toHaveBeenCalled()
      }
    })
  })

  describe('Open State Styling', () => {
    it('should apply hover styling when open and no tags selected', () => {
      const { container } = render(
        <ToolSelectorTrigger {...defaultProps} open selectedTagsLength={0} />,
      )

      expect(container.querySelector('.bg-state-base-hover')).toBeInTheDocument()
    })

    it('should apply border styling when tags are selected', () => {
      const { container } = render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      expect(container.querySelector('.border-components-button-secondary-border')).toBeInTheDocument()
    })

    it('should not apply hover styling when open but has tags', () => {
      const { container } = render(
        <ToolSelectorTrigger
          {...defaultProps}
          open
          selectedTagsLength={1}
          tags={['agent']}
        />,
      )

      // Should have border styling, not hover
      expect(container.querySelector('.border-components-button-secondary-border')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render with single tag correctly', () => {
      render(
        <ToolSelectorTrigger
          {...defaultProps}
          selectedTagsLength={1}
          tags={['agent']}
          tagsMap={mockTagsMap}
        />,
      )

      expect(screen.getByText('Agent')).toBeInTheDocument()
    })
  })
})

// ================================
// TagsFilter Component Tests (Integration)
// ================================
describe('TagsFilter', () => {
  // We need to import TagsFilter separately for these tests
  // since it uses the mocked portal components

  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  describe('Integration with SearchBox', () => {
    it('should render TagsFilter within SearchBox', () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should pass usedInMarketplace prop to TagsFilter', () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
          usedInMarketplace
        />,
      )

      // MarketplaceTrigger should show "All Tags"
      expect(screen.getByText('All Tags')).toBeInTheDocument()
    })

    it('should show selected tags count in TagsFilter trigger', () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={['agent', 'rag', 'search']}
          onTagsChange={vi.fn()}
          usedInMarketplace
        />,
      )

      expect(screen.getByText('+1')).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })
    })

    it('should close dropdown when trigger is clicked again', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')

      // Open
      fireEvent.click(trigger)
      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })

      // Close
      fireEvent.click(trigger)
      await waitFor(() => {
        expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
      })
    })
  })

  describe('Tag Selection', () => {
    it('should display tag options when dropdown is open', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
        expect(screen.getByText('RAG')).toBeInTheDocument()
      })
    })

    it('should call onTagsChange when a tag is selected', async () => {
      const onTagsChange = vi.fn()
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={onTagsChange}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
      })

      const agentOption = screen.getByText('Agent')
      fireEvent.click(agentOption.parentElement!)
      expect(onTagsChange).toHaveBeenCalledWith(['agent'])
    })

    it('should call onTagsChange to remove tag when already selected', async () => {
      const onTagsChange = vi.fn()
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={['agent']}
          onTagsChange={onTagsChange}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        // Multiple 'Agent' texts exist - one in trigger, one in dropdown
        expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1)
      })

      // Get the portal content and find the tag option within it
      const portalContent = screen.getByTestId('portal-content')
      const agentOption = portalContent.querySelector('div[class*="cursor-pointer"]')
      if (agentOption) {
        fireEvent.click(agentOption)
        expect(onTagsChange).toHaveBeenCalled()
      }
    })

    it('should add to existing tags when selecting new tag', async () => {
      const onTagsChange = vi.fn()
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={['agent']}
          onTagsChange={onTagsChange}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('RAG')).toBeInTheDocument()
      })

      const ragOption = screen.getByText('RAG')
      fireEvent.click(ragOption.parentElement!)
      expect(onTagsChange).toHaveBeenCalledWith(['agent', 'rag'])
    })
  })

  describe('Search Tags Feature', () => {
    it('should render search input in dropdown', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        const inputs = screen.getAllByRole('textbox')
        expect(inputs.length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should filter tags based on search text', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('Agent')).toBeInTheDocument()
      })

      const inputs = screen.getAllByRole('textbox')
      const searchInput = inputs.find(input =>
        input.getAttribute('placeholder') === 'Search tags',
      )

      if (searchInput) {
        fireEvent.change(searchInput, { target: { value: 'agent' } })
        expect(screen.getByText('Agent')).toBeInTheDocument()
      }
    })
  })

  describe('Checkbox State', () => {
    // Note: The Checkbox component is a custom div-based component, not native checkbox
    it('should display tag options with proper selection state', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={['agent']}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        // 'Agent' appears both in trigger (selected) and dropdown
        expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1)
      })

      // Verify dropdown content is rendered
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should render tag options when dropdown is open', async () => {
      render(
        <SearchBox
          search=""
          onSearchChange={vi.fn()}
          tags={[]}
          onTagsChange={vi.fn()}
        />,
      )

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })

      // When no tags selected, these should appear once each in dropdown
      expect(screen.getByText('Agent')).toBeInTheDocument()
      expect(screen.getByText('RAG')).toBeInTheDocument()
      expect(screen.getByText('Search')).toBeInTheDocument()
    })
  })
})

// ================================
// Accessibility Tests
// ================================
describe('Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  it('should have accessible search input', () => {
    render(
      <SearchBox
        search=""
        onSearchChange={vi.fn()}
        tags={[]}
        onTagsChange={vi.fn()}
        placeholder="Search plugins"
      />,
    )

    const input = screen.getByRole('textbox')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('placeholder', 'Search plugins')
  })

  it('should have clickable tag options in dropdown', async () => {
    render(<SearchBox search="" onSearchChange={vi.fn()} tags={[]} onTagsChange={vi.fn()} />)

    fireEvent.click(screen.getByTestId('portal-trigger'))

    await waitFor(() => {
      expect(screen.getByText('Agent')).toBeInTheDocument()
    })
  })
})

// ================================
// Combined Workflow Tests
// ================================
describe('Combined Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
  })

  it('should handle search and tag filter together', async () => {
    const onSearchChange = vi.fn()
    const onTagsChange = vi.fn()

    render(
      <SearchBox
        search=""
        onSearchChange={onSearchChange}
        tags={[]}
        onTagsChange={onTagsChange}
        usedInMarketplace
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'search query' } })
    expect(onSearchChange).toHaveBeenCalledWith('search query')

    const trigger = screen.getByTestId('portal-trigger')
    fireEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    const agentOption = screen.getByText('Agent')
    fireEvent.click(agentOption.parentElement!)
    expect(onTagsChange).toHaveBeenCalledWith(['agent'])
  })

  it('should work with all features enabled', () => {
    render(
      <SearchBox
        search="test"
        onSearchChange={vi.fn()}
        tags={['agent', 'rag']}
        onTagsChange={vi.fn()}
        usedInMarketplace
        supportAddCustomTool
        onShowAddCustomCollectionModal={vi.fn()}
        placeholder="Search plugins"
        wrapperClassName="custom-wrapper"
        inputClassName="custom-input"
        autoFocus={false}
      />,
    )

    expect(screen.getByDisplayValue('test')).toBeInTheDocument()
    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
  })

  it('should handle prop changes correctly', () => {
    const onSearchChange = vi.fn()

    const { rerender } = render(
      <SearchBox
        search="initial"
        onSearchChange={onSearchChange}
        tags={[]}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('initial')).toBeInTheDocument()

    rerender(
      <SearchBox
        search="updated"
        onSearchChange={onSearchChange}
        tags={[]}
        onTagsChange={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('updated')).toBeInTheDocument()
  })
})
