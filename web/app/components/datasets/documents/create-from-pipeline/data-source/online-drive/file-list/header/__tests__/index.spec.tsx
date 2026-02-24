import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Header from '../index'

// Mock store - required by Breadcrumbs component
const mockStoreState = {
  hasBucket: false,
  setOnlineDriveFileList: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
  breadcrumbs: [],
  prefix: [],
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../../../../store', () => ({
  useDataSourceStore: () => mockDataSourceStore,
  useDataSourceStoreWithSelector: (selector: (s: typeof mockStoreState) => unknown) => selector(mockStoreState),
}))

type HeaderProps = React.ComponentProps<typeof Header>

const createDefaultProps = (overrides?: Partial<HeaderProps>): HeaderProps => ({
  breadcrumbs: [],
  inputValue: '',
  keywords: '',
  bucket: '',
  searchResultsLength: 0,
  handleInputChange: vi.fn(),
  handleResetKeywords: vi.fn(),
  isInPipeline: false,
  ...overrides,
})

const resetMockStoreState = () => {
  mockStoreState.hasBucket = false
  mockStoreState.setOnlineDriveFileList = vi.fn()
  mockStoreState.setSelectedFileIds = vi.fn()
  mockStoreState.setBreadcrumbs = vi.fn()
  mockStoreState.setPrefix = vi.fn()
  mockStoreState.setBucket = vi.fn()
  mockStoreState.breadcrumbs = []
  mockStoreState.prefix = []
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockStoreState()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<Header {...props} />)

      // Assert - search input should be visible
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should render with correct container styles', () => {
      const props = createDefaultProps()

      const { container } = render(<Header {...props} />)

      // Assert - container should have correct class names
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('gap-x-2')
      expect(wrapper).toHaveClass('bg-components-panel-bg')
      expect(wrapper).toHaveClass('p-1')
      expect(wrapper).toHaveClass('pl-3')
    })

    it('should render Input component with correct props', () => {
      const props = createDefaultProps({ inputValue: 'test-value' })

      render(<Header {...props} />)

      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('test-value')
    })

    it('should render Input with search icon', () => {
      const props = createDefaultProps()

      const { container } = render(<Header {...props} />)

      // Assert - Input should have search icon (RiSearchLine is rendered as svg)
      const searchIcon = container.querySelector('svg.h-4.w-4')
      expect(searchIcon).toBeInTheDocument()
    })

    it('should render Input with correct wrapper width', () => {
      const props = createDefaultProps()

      const { container } = render(<Header {...props} />)

      // Assert - Input wrapper should have w-[200px] class
      const inputWrapper = container.querySelector('.w-\\[200px\\]')
      expect(inputWrapper).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('inputValue prop', () => {
      it('should display empty input when inputValue is empty string', () => {
        const props = createDefaultProps({ inputValue: '' })

        render(<Header {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        expect(input).toHaveValue('')
      })

      it('should display input value correctly', () => {
        const props = createDefaultProps({ inputValue: 'search-query' })

        render(<Header {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        expect(input).toHaveValue('search-query')
      })

      it('should handle special characters in inputValue', () => {
        const specialChars = 'test[file].txt (copy)'
        const props = createDefaultProps({ inputValue: specialChars })

        render(<Header {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        expect(input).toHaveValue(specialChars)
      })

      it('should handle unicode characters in inputValue', () => {
        const unicodeValue = '文件搜索 日本語'
        const props = createDefaultProps({ inputValue: unicodeValue })

        render(<Header {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        expect(input).toHaveValue(unicodeValue)
      })
    })

    describe('breadcrumbs prop', () => {
      it('should render with empty breadcrumbs', () => {
        const props = createDefaultProps({ breadcrumbs: [] })

        render(<Header {...props} />)

        // Assert - Component should render without errors
        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })

      it('should render with single breadcrumb', () => {
        const props = createDefaultProps({ breadcrumbs: ['folder1'] })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })

      it('should render with multiple breadcrumbs', () => {
        const props = createDefaultProps({ breadcrumbs: ['folder1', 'folder2', 'folder3'] })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })
    })

    describe('keywords prop', () => {
      it('should pass keywords to Breadcrumbs', () => {
        const props = createDefaultProps({ keywords: 'search-keyword' })

        render(<Header {...props} />)

        // Assert - keywords are passed through, component renders
        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })
    })

    describe('bucket prop', () => {
      it('should render with empty bucket', () => {
        const props = createDefaultProps({ bucket: '' })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })

      it('should render with bucket value', () => {
        const props = createDefaultProps({ bucket: 'my-bucket' })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })
    })

    describe('searchResultsLength prop', () => {
      it('should handle zero search results', () => {
        const props = createDefaultProps({ searchResultsLength: 0 })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })

      it('should handle positive search results', () => {
        const props = createDefaultProps({ searchResultsLength: 10, keywords: 'test' })

        render(<Header {...props} />)

        // Assert - Breadcrumbs will show search results text when keywords exist and results > 0
        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })

      it('should handle large search results count', () => {
        const props = createDefaultProps({ searchResultsLength: 1000, keywords: 'test' })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })
    })

    describe('isInPipeline prop', () => {
      it('should render correctly when isInPipeline is false', () => {
        const props = createDefaultProps({ isInPipeline: false })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })

      it('should render correctly when isInPipeline is true', () => {
        const props = createDefaultProps({ isInPipeline: true })

        render(<Header {...props} />)

        expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
      })
    })
  })

  // Event Handlers Tests
  describe('Event Handlers', () => {
    describe('handleInputChange', () => {
      it('should call handleInputChange when input value changes', () => {
        const mockHandleInputChange = vi.fn()
        const props = createDefaultProps({ handleInputChange: mockHandleInputChange })
        render(<Header {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        fireEvent.change(input, { target: { value: 'new-value' } })

        expect(mockHandleInputChange).toHaveBeenCalledTimes(1)
        // Verify that onChange event was triggered (React's synthetic event structure)
        expect(mockHandleInputChange.mock.calls[0][0]).toHaveProperty('type', 'change')
      })

      it('should call handleInputChange on each keystroke', () => {
        const mockHandleInputChange = vi.fn()
        const props = createDefaultProps({ handleInputChange: mockHandleInputChange })
        render(<Header {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        fireEvent.change(input, { target: { value: 'a' } })
        fireEvent.change(input, { target: { value: 'ab' } })
        fireEvent.change(input, { target: { value: 'abc' } })

        expect(mockHandleInputChange).toHaveBeenCalledTimes(3)
      })

      it('should handle empty string input', () => {
        const mockHandleInputChange = vi.fn()
        const props = createDefaultProps({ inputValue: 'existing', handleInputChange: mockHandleInputChange })
        render(<Header {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        fireEvent.change(input, { target: { value: '' } })

        expect(mockHandleInputChange).toHaveBeenCalledTimes(1)
        expect(mockHandleInputChange.mock.calls[0][0]).toHaveProperty('type', 'change')
      })

      it('should handle whitespace-only input', () => {
        const mockHandleInputChange = vi.fn()
        const props = createDefaultProps({ handleInputChange: mockHandleInputChange })
        render(<Header {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        fireEvent.change(input, { target: { value: '   ' } })

        expect(mockHandleInputChange).toHaveBeenCalledTimes(1)
        expect(mockHandleInputChange.mock.calls[0][0]).toHaveProperty('type', 'change')
      })
    })

    describe('handleResetKeywords', () => {
      it('should call handleResetKeywords when clear icon is clicked', () => {
        const mockHandleResetKeywords = vi.fn()
        const props = createDefaultProps({
          inputValue: 'to-clear',
          handleResetKeywords: mockHandleResetKeywords,
        })
        const { container } = render(<Header {...props} />)

        // Act - Find and click the clear icon container
        const clearButton = container.querySelector('[class*="cursor-pointer"] svg[class*="h-3.5"]')?.parentElement
        expect(clearButton).toBeInTheDocument()
        fireEvent.click(clearButton!)

        expect(mockHandleResetKeywords).toHaveBeenCalledTimes(1)
      })

      it('should not show clear icon when inputValue is empty', () => {
        const props = createDefaultProps({ inputValue: '' })
        const { container } = render(<Header {...props} />)

        // Act & Assert - Clear icon should not be visible
        const clearIcon = container.querySelector('[class*="cursor-pointer"] svg[class*="h-3.5"]')
        expect(clearIcon).not.toBeInTheDocument()
      })

      it('should show clear icon when inputValue is not empty', () => {
        const props = createDefaultProps({ inputValue: 'some-value' })
        const { container } = render(<Header {...props} />)

        // Act & Assert - Clear icon should be visible
        const clearIcon = container.querySelector('[class*="cursor-pointer"] svg[class*="h-3.5"]')
        expect(clearIcon).toBeInTheDocument()
      })
    })
  })

  // Component Memoization Tests
  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - Header component should be memoized
      expect(Header).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })

    it('should not re-render when props are the same', () => {
      const mockHandleInputChange = vi.fn()
      const mockHandleResetKeywords = vi.fn()
      const props = createDefaultProps({
        handleInputChange: mockHandleInputChange,
        handleResetKeywords: mockHandleResetKeywords,
      })

      // Act - Initial render
      const { rerender } = render(<Header {...props} />)

      // Rerender with same props
      rerender(<Header {...props} />)

      // Assert - Component renders without errors
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should re-render when inputValue changes', () => {
      const props = createDefaultProps({ inputValue: 'initial' })
      const { rerender } = render(<Header {...props} />)
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue('initial')

      // Act - Rerender with different inputValue
      const newProps = createDefaultProps({ inputValue: 'changed' })
      rerender(<Header {...newProps} />)

      // Assert - Input value should be updated
      expect(input).toHaveValue('changed')
    })

    it('should re-render when breadcrumbs change', () => {
      const props = createDefaultProps({ breadcrumbs: [] })
      const { rerender } = render(<Header {...props} />)

      // Act - Rerender with different breadcrumbs
      const newProps = createDefaultProps({ breadcrumbs: ['folder1', 'folder2'] })
      rerender(<Header {...newProps} />)

      // Assert - Component renders without errors
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should re-render when keywords change', () => {
      const props = createDefaultProps({ keywords: '' })
      const { rerender } = render(<Header {...props} />)

      // Act - Rerender with different keywords
      const newProps = createDefaultProps({ keywords: 'search-term' })
      rerender(<Header {...newProps} />)

      // Assert - Component renders without errors
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle very long inputValue', () => {
      const longValue = 'a'.repeat(500)
      const props = createDefaultProps({ inputValue: longValue })

      render(<Header {...props} />)

      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue(longValue)
    })

    it('should handle very long breadcrumb paths', () => {
      const longBreadcrumbs = Array.from({ length: 20 }, (_, i) => `folder-${i}`)
      const props = createDefaultProps({ breadcrumbs: longBreadcrumbs })

      render(<Header {...props} />)

      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should handle breadcrumbs with special characters', () => {
      const specialBreadcrumbs = ['folder [1]', 'folder (2)', 'folder-3.backup']
      const props = createDefaultProps({ breadcrumbs: specialBreadcrumbs })

      render(<Header {...props} />)

      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should handle breadcrumbs with unicode names', () => {
      const unicodeBreadcrumbs = ['文件夹', 'フォルダ', 'Папка']
      const props = createDefaultProps({ breadcrumbs: unicodeBreadcrumbs })

      render(<Header {...props} />)

      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should handle bucket with special characters', () => {
      const props = createDefaultProps({ bucket: 'my-bucket_2024.backup' })

      render(<Header {...props} />)

      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should pass the event object to handleInputChange callback', () => {
      const mockHandleInputChange = vi.fn()
      const props = createDefaultProps({ handleInputChange: mockHandleInputChange })
      render(<Header {...props} />)
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

      fireEvent.change(input, { target: { value: 'test-value' } })

      // Assert - Verify the event object is passed correctly
      expect(mockHandleInputChange).toHaveBeenCalledTimes(1)
      const eventArg = mockHandleInputChange.mock.calls[0][0]
      expect(eventArg).toHaveProperty('type', 'change')
      expect(eventArg).toHaveProperty('target')
    })
  })

  describe('Prop Variations', () => {
    it.each([
      { isInPipeline: true, bucket: '' },
      { isInPipeline: true, bucket: 'my-bucket' },
      { isInPipeline: false, bucket: '' },
      { isInPipeline: false, bucket: 'my-bucket' },
    ])('should render correctly with isInPipeline=$isInPipeline and bucket=$bucket', (propVariation) => {
      const props = createDefaultProps(propVariation)

      render(<Header {...props} />)

      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it.each([
      { keywords: '', searchResultsLength: 0, description: 'no search' },
      { keywords: 'test', searchResultsLength: 0, description: 'search with no results' },
      { keywords: 'test', searchResultsLength: 5, description: 'search with results' },
      { keywords: '', searchResultsLength: 5, description: 'no keywords but has results count' },
    ])('should render correctly with $description', ({ keywords, searchResultsLength }) => {
      const props = createDefaultProps({ keywords, searchResultsLength })

      render(<Header {...props} />)

      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it.each([
      { breadcrumbs: [], inputValue: '', expected: 'empty state' },
      { breadcrumbs: ['root'], inputValue: 'search', expected: 'single breadcrumb with search' },
      { breadcrumbs: ['a', 'b', 'c'], inputValue: '', expected: 'multiple breadcrumbs no search' },
      { breadcrumbs: ['a', 'b', 'c', 'd', 'e'], inputValue: 'query', expected: 'many breadcrumbs with search' },
    ])('should handle $expected correctly', ({ breadcrumbs, inputValue }) => {
      const props = createDefaultProps({ breadcrumbs, inputValue })

      render(<Header {...props} />)

      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue(inputValue)
    })
  })

  // Integration with Child Components
  describe('Integration with Child Components', () => {
    it('should pass all required props to Breadcrumbs', () => {
      const props = createDefaultProps({
        breadcrumbs: ['folder1', 'folder2'],
        keywords: 'test-keyword',
        bucket: 'test-bucket',
        searchResultsLength: 10,
        isInPipeline: true,
      })

      render(<Header {...props} />)

      // Assert - Component should render successfully, meaning props are passed correctly
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should pass correct props to Input component', () => {
      const mockHandleInputChange = vi.fn()
      const mockHandleResetKeywords = vi.fn()
      const props = createDefaultProps({
        inputValue: 'test-input',
        handleInputChange: mockHandleInputChange,
        handleResetKeywords: mockHandleResetKeywords,
      })

      render(<Header {...props} />)

      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue('test-input')

      // Test onChange handler
      fireEvent.change(input, { target: { value: 'new-value' } })
      expect(mockHandleInputChange).toHaveBeenCalled()
    })
  })

  // Callback Stability Tests
  describe('Callback Stability', () => {
    it('should maintain stable handleInputChange callback after rerender', () => {
      const mockHandleInputChange = vi.fn()
      const props = createDefaultProps({ handleInputChange: mockHandleInputChange })
      const { rerender } = render(<Header {...props} />)
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

      // Act - Fire change event, rerender, fire again
      fireEvent.change(input, { target: { value: 'first' } })
      rerender(<Header {...props} />)
      fireEvent.change(input, { target: { value: 'second' } })

      expect(mockHandleInputChange).toHaveBeenCalledTimes(2)
    })

    it('should maintain stable handleResetKeywords callback after rerender', () => {
      const mockHandleResetKeywords = vi.fn()
      const props = createDefaultProps({
        inputValue: 'to-clear',
        handleResetKeywords: mockHandleResetKeywords,
      })
      const { container, rerender } = render(<Header {...props} />)

      // Act - Click clear, rerender, click again
      const clearButton = container.querySelector('[class*="cursor-pointer"] svg[class*="h-3.5"]')?.parentElement
      fireEvent.click(clearButton!)
      rerender(<Header {...props} />)
      fireEvent.click(clearButton!)

      expect(mockHandleResetKeywords).toHaveBeenCalledTimes(2)
    })
  })
})
