import type { OnlineDriveFile } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { OnlineDriveFileType } from '@/models/pipeline'
import FileList from './index'

// ==========================================
// Mock Modules
// ==========================================

// Note: react-i18next uses global mock from web/vitest.setup.ts

// Mock ahooks useDebounceFn - third-party library requires mocking
const mockDebounceFnRun = vi.fn()
vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: any[]) => void) => {
    mockDebounceFnRun.mockImplementation(fn)
    return { run: mockDebounceFnRun }
  },
}))

// Mock store - context provider requires mocking
const mockStoreState = {
  setNextPageParameters: vi.fn(),
  currentNextPageParametersRef: { current: {} },
  isTruncated: { current: false },
  hasBucket: false,
  setOnlineDriveFileList: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../../store', () => ({
  useDataSourceStore: () => mockDataSourceStore,
  useDataSourceStoreWithSelector: (selector: (s: any) => any) => selector(mockStoreState),
}))

// ==========================================
// Test Data Builders
// ==========================================
const createMockOnlineDriveFile = (overrides?: Partial<OnlineDriveFile>): OnlineDriveFile => ({
  id: 'file-1',
  name: 'test-file.txt',
  size: 1024,
  type: OnlineDriveFileType.file,
  ...overrides,
})

type FileListProps = React.ComponentProps<typeof FileList>

const createDefaultProps = (overrides?: Partial<FileListProps>): FileListProps => ({
  fileList: [],
  selectedFileIds: [],
  breadcrumbs: [],
  keywords: '',
  bucket: '',
  isInPipeline: false,
  resetKeywords: vi.fn(),
  updateKeywords: vi.fn(),
  searchResultsLength: 0,
  handleSelectFile: vi.fn(),
  handleOpenFolder: vi.fn(),
  isLoading: false,
  supportBatchUpload: true,
  ...overrides,
})

// ==========================================
// Helper Functions
// ==========================================
const resetMockStoreState = () => {
  mockStoreState.setNextPageParameters = vi.fn()
  mockStoreState.currentNextPageParametersRef = { current: {} }
  mockStoreState.isTruncated = { current: false }
  mockStoreState.hasBucket = false
  mockStoreState.setOnlineDriveFileList = vi.fn()
  mockStoreState.setSelectedFileIds = vi.fn()
  mockStoreState.setBreadcrumbs = vi.fn()
  mockStoreState.setPrefix = vi.fn()
  mockStoreState.setBucket = vi.fn()
}

// ==========================================
// Test Suites
// ==========================================
describe('FileList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockStoreState()
    mockDebounceFnRun.mockClear()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileList {...props} />)

      // Assert - search input should be visible
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it('should render with correct container styles', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<FileList {...props} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('h-[400px]')
      expect(wrapper).toHaveClass('flex-col')
      expect(wrapper).toHaveClass('overflow-hidden')
      expect(wrapper).toHaveClass('rounded-xl')
    })

    it('should render Header component with search input', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileList {...props} />)

      // Assert
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toBeInTheDocument()
    })

    it('should render files when fileList has items', () => {
      // Arrange
      const fileList = [
        createMockOnlineDriveFile({ id: 'file-1', name: 'file1.txt' }),
        createMockOnlineDriveFile({ id: 'file-2', name: 'file2.txt' }),
      ]
      const props = createDefaultProps({ fileList })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText('file1.txt')).toBeInTheDocument()
      expect(screen.getByText('file2.txt')).toBeInTheDocument()
    })

    it('should show loading state when isLoading is true and fileList is empty', () => {
      // Arrange
      const props = createDefaultProps({ isLoading: true, fileList: [] })

      // Act
      const { container } = render(<FileList {...props} />)

      // Assert - Loading component should be rendered with spin-animation class
      expect(container.querySelector('.spin-animation')).toBeInTheDocument()
    })

    it('should show empty folder state when not loading and fileList is empty', () => {
      // Arrange
      const props = createDefaultProps({ isLoading: false, fileList: [], keywords: '' })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText('datasetPipeline.onlineDrive.emptyFolder')).toBeInTheDocument()
    })

    it('should show empty search result when not loading, fileList is empty, and keywords exist', () => {
      // Arrange
      const props = createDefaultProps({ isLoading: false, fileList: [], keywords: 'search-term' })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText('datasetPipeline.onlineDrive.emptySearchResult')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('fileList prop', () => {
      it('should render all files from fileList', () => {
        // Arrange
        const fileList = [
          createMockOnlineDriveFile({ id: '1', name: 'a.txt' }),
          createMockOnlineDriveFile({ id: '2', name: 'b.txt' }),
          createMockOnlineDriveFile({ id: '3', name: 'c.txt' }),
        ]
        const props = createDefaultProps({ fileList })

        // Act
        render(<FileList {...props} />)

        // Assert
        expect(screen.getByText('a.txt')).toBeInTheDocument()
        expect(screen.getByText('b.txt')).toBeInTheDocument()
        expect(screen.getByText('c.txt')).toBeInTheDocument()
      })

      it('should handle empty fileList', () => {
        // Arrange
        const props = createDefaultProps({ fileList: [] })

        // Act
        render(<FileList {...props} />)

        // Assert - Should show empty folder state
        expect(screen.getByText('datasetPipeline.onlineDrive.emptyFolder')).toBeInTheDocument()
      })
    })

    describe('selectedFileIds prop', () => {
      it('should mark files as selected based on selectedFileIds', () => {
        // Arrange
        const fileList = [
          createMockOnlineDriveFile({ id: 'file-1', name: 'file1.txt' }),
          createMockOnlineDriveFile({ id: 'file-2', name: 'file2.txt' }),
        ]
        const props = createDefaultProps({ fileList, selectedFileIds: ['file-1'] })

        // Act
        render(<FileList {...props} />)

        // Assert - The checkbox for file-1 should be checked (check icon present)
        expect(screen.getByTestId('checkbox-file-1')).toBeInTheDocument()
        expect(screen.getByTestId('check-icon-file-1')).toBeInTheDocument()
        expect(screen.getByTestId('checkbox-file-2')).toBeInTheDocument()
        expect(screen.queryByTestId('check-icon-file-2')).not.toBeInTheDocument()
      })
    })

    describe('keywords prop', () => {
      it('should initialize input with keywords value', () => {
        // Arrange
        const props = createDefaultProps({ keywords: 'my-search' })

        // Act
        render(<FileList {...props} />)

        // Assert
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        expect(input).toHaveValue('my-search')
      })
    })

    describe('isLoading prop', () => {
      it('should show loading when isLoading is true with empty list', () => {
        // Arrange
        const props = createDefaultProps({ isLoading: true, fileList: [] })

        // Act
        const { container } = render(<FileList {...props} />)

        // Assert - Loading component with spin-animation class
        expect(container.querySelector('.spin-animation')).toBeInTheDocument()
      })

      it('should show loading indicator at bottom when isLoading is true with files', () => {
        // Arrange
        const fileList = [createMockOnlineDriveFile()]
        const props = createDefaultProps({ isLoading: true, fileList })

        // Act
        const { container } = render(<FileList {...props} />)

        // Assert - Should show spinner icon at the bottom
        expect(container.querySelector('.animation-spin')).toBeInTheDocument()
      })
    })

    describe('supportBatchUpload prop', () => {
      it('should render checkboxes when supportBatchUpload is true', () => {
        // Arrange
        const fileList = [createMockOnlineDriveFile({ id: 'file-1', name: 'file1.txt' })]
        const props = createDefaultProps({ fileList, supportBatchUpload: true })

        // Act
        render(<FileList {...props} />)

        // Assert - Checkbox component has data-testid="checkbox-{id}"
        expect(screen.getByTestId('checkbox-file-1')).toBeInTheDocument()
      })

      it('should render radio buttons when supportBatchUpload is false', () => {
        // Arrange
        const fileList = [createMockOnlineDriveFile({ id: 'file-1', name: 'file1.txt' })]
        const props = createDefaultProps({ fileList, supportBatchUpload: false })

        // Act
        const { container } = render(<FileList {...props} />)

        // Assert - Radio is rendered as a div with rounded-full class
        expect(container.querySelector('.rounded-full')).toBeInTheDocument()
        // And checkbox should not be present
        expect(screen.queryByTestId('checkbox-file-1')).not.toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // State Management Tests
  // ==========================================
  describe('State Management', () => {
    describe('inputValue state', () => {
      it('should initialize inputValue with keywords prop', () => {
        // Arrange
        const props = createDefaultProps({ keywords: 'initial-keyword' })

        // Act
        render(<FileList {...props} />)

        // Assert
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        expect(input).toHaveValue('initial-keyword')
      })

      it('should update inputValue when input changes', () => {
        // Arrange
        const props = createDefaultProps({ keywords: '' })
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        // Act
        fireEvent.change(input, { target: { value: 'new-value' } })

        // Assert
        expect(input).toHaveValue('new-value')
      })
    })

    describe('debounced keywords update', () => {
      it('should call updateKeywords with debounce when input changes', () => {
        // Arrange
        const mockUpdateKeywords = vi.fn()
        const props = createDefaultProps({ updateKeywords: mockUpdateKeywords })
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        // Act
        fireEvent.change(input, { target: { value: 'debounced-value' } })

        // Assert
        expect(mockDebounceFnRun).toHaveBeenCalledWith('debounced-value')
      })
    })
  })

  // ==========================================
  // Event Handlers Tests
  // ==========================================
  describe('Event Handlers', () => {
    describe('handleInputChange', () => {
      it('should update inputValue on input change', () => {
        // Arrange
        const props = createDefaultProps()
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        // Act
        fireEvent.change(input, { target: { value: 'typed-text' } })

        // Assert
        expect(input).toHaveValue('typed-text')
      })

      it('should trigger debounced updateKeywords on input change', () => {
        // Arrange
        const mockUpdateKeywords = vi.fn()
        const props = createDefaultProps({ updateKeywords: mockUpdateKeywords })
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        // Act
        fireEvent.change(input, { target: { value: 'search-term' } })

        // Assert
        expect(mockDebounceFnRun).toHaveBeenCalledWith('search-term')
      })

      it('should handle multiple sequential input changes', () => {
        // Arrange
        const mockUpdateKeywords = vi.fn()
        const props = createDefaultProps({ updateKeywords: mockUpdateKeywords })
        render(<FileList {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

        // Act
        fireEvent.change(input, { target: { value: 'a' } })
        fireEvent.change(input, { target: { value: 'ab' } })
        fireEvent.change(input, { target: { value: 'abc' } })

        // Assert
        expect(mockDebounceFnRun).toHaveBeenCalledTimes(3)
        expect(mockDebounceFnRun).toHaveBeenLastCalledWith('abc')
        expect(input).toHaveValue('abc')
      })
    })

    describe('handleResetKeywords', () => {
      it('should call resetKeywords prop when clear button is clicked', () => {
        // Arrange
        const mockResetKeywords = vi.fn()
        const props = createDefaultProps({ resetKeywords: mockResetKeywords, keywords: 'to-reset' })
        const { container } = render(<FileList {...props} />)

        // Act - Click the clear icon div (it contains RiCloseCircleFill icon)
        const clearButton = container.querySelector('[class*="cursor-pointer"] svg[class*="h-3.5"]')?.parentElement
        expect(clearButton).toBeInTheDocument()
        fireEvent.click(clearButton!)

        // Assert
        expect(mockResetKeywords).toHaveBeenCalledTimes(1)
      })

      it('should reset inputValue to empty string when clear is clicked', () => {
        // Arrange
        const props = createDefaultProps({ keywords: 'to-be-reset' })
        const { container } = render(<FileList {...props} />)
        const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
        fireEvent.change(input, { target: { value: 'some-search' } })

        // Act - Find and click the clear icon
        const clearButton = container.querySelector('[class*="cursor-pointer"] svg[class*="h-3.5"]')?.parentElement
        expect(clearButton).toBeInTheDocument()
        fireEvent.click(clearButton!)

        // Assert
        expect(input).toHaveValue('')
      })
    })

    describe('handleSelectFile', () => {
      it('should call handleSelectFile when file item is clicked', () => {
        // Arrange
        const mockHandleSelectFile = vi.fn()
        const fileList = [createMockOnlineDriveFile({ id: 'file-1', name: 'test.txt' })]
        const props = createDefaultProps({ handleSelectFile: mockHandleSelectFile, fileList })
        render(<FileList {...props} />)

        // Act - Click on the file item
        const fileItem = screen.getByText('test.txt')
        fireEvent.click(fileItem.closest('[class*="cursor-pointer"]')!)

        // Assert
        expect(mockHandleSelectFile).toHaveBeenCalledWith(expect.objectContaining({
          id: 'file-1',
          name: 'test.txt',
          type: OnlineDriveFileType.file,
        }))
      })
    })

    describe('handleOpenFolder', () => {
      it('should call handleOpenFolder when folder item is clicked', () => {
        // Arrange
        const mockHandleOpenFolder = vi.fn()
        const fileList = [createMockOnlineDriveFile({ id: 'folder-1', name: 'my-folder', type: OnlineDriveFileType.folder })]
        const props = createDefaultProps({ handleOpenFolder: mockHandleOpenFolder, fileList })
        render(<FileList {...props} />)

        // Act - Click on the folder item
        const folderItem = screen.getByText('my-folder')
        fireEvent.click(folderItem.closest('[class*="cursor-pointer"]')!)

        // Assert
        expect(mockHandleOpenFolder).toHaveBeenCalledWith(expect.objectContaining({
          id: 'folder-1',
          name: 'my-folder',
          type: OnlineDriveFileType.folder,
        }))
      })
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty string keywords', () => {
      // Arrange
      const props = createDefaultProps({ keywords: '' })

      // Act
      render(<FileList {...props} />)

      // Assert
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue('')
    })

    it('should handle special characters in keywords', () => {
      // Arrange
      const specialChars = 'test[file].txt (copy)'
      const props = createDefaultProps({ keywords: specialChars })

      // Act
      render(<FileList {...props} />)

      // Assert
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue(specialChars)
    })

    it('should handle unicode characters in keywords', () => {
      // Arrange
      const unicodeKeywords = '文件搜索 日本語'
      const props = createDefaultProps({ keywords: unicodeKeywords })

      // Act
      render(<FileList {...props} />)

      // Assert
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue(unicodeKeywords)
    })

    it('should handle very long file names in fileList', () => {
      // Arrange
      const longName = `${'a'.repeat(100)}.txt`
      const fileList = [createMockOnlineDriveFile({ id: '1', name: longName })]
      const props = createDefaultProps({ fileList })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle large number of files', () => {
      // Arrange
      const fileList = Array.from({ length: 50 }, (_, i) =>
        createMockOnlineDriveFile({ id: `file-${i}`, name: `file-${i}.txt` }))
      const props = createDefaultProps({ fileList })

      // Act
      render(<FileList {...props} />)

      // Assert - Check a few files exist
      expect(screen.getByText('file-0.txt')).toBeInTheDocument()
      expect(screen.getByText('file-49.txt')).toBeInTheDocument()
    })

    it('should handle whitespace-only keywords input', () => {
      // Arrange
      const props = createDefaultProps()
      render(<FileList {...props} />)
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')

      // Act
      fireEvent.change(input, { target: { value: '   ' } })

      // Assert
      expect(input).toHaveValue('   ')
      expect(mockDebounceFnRun).toHaveBeenCalledWith('   ')
    })
  })

  // ==========================================
  // All Prop Variations Tests
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      { isInPipeline: true, supportBatchUpload: true },
      { isInPipeline: true, supportBatchUpload: false },
      { isInPipeline: false, supportBatchUpload: true },
      { isInPipeline: false, supportBatchUpload: false },
    ])('should render correctly with isInPipeline=$isInPipeline and supportBatchUpload=$supportBatchUpload', (propVariation) => {
      // Arrange
      const props = createDefaultProps(propVariation)

      // Act
      render(<FileList {...props} />)

      // Assert - Component should render without crashing
      expect(screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')).toBeInTheDocument()
    })

    it.each([
      { isLoading: true, fileCount: 0, description: 'loading state with no files' },
      { isLoading: false, fileCount: 0, description: 'not loading with no files' },
      { isLoading: false, fileCount: 3, description: 'not loading with files' },
    ])('should handle $description correctly', ({ isLoading, fileCount }) => {
      // Arrange
      const fileList = Array.from({ length: fileCount }, (_, i) =>
        createMockOnlineDriveFile({ id: `file-${i}`, name: `file-${i}.txt` }))
      const props = createDefaultProps({ isLoading, fileList })

      // Act
      const { container } = render(<FileList {...props} />)

      // Assert
      if (isLoading && fileCount === 0)
        expect(container.querySelector('.spin-animation')).toBeInTheDocument()

      else if (!isLoading && fileCount === 0)
        expect(screen.getByText('datasetPipeline.onlineDrive.emptyFolder')).toBeInTheDocument()

      else
        expect(screen.getByText('file-0.txt')).toBeInTheDocument()
    })

    it.each([
      { keywords: '', searchResultsLength: 0 },
      { keywords: 'test', searchResultsLength: 5 },
      { keywords: 'not-found', searchResultsLength: 0 },
    ])('should render correctly with keywords="$keywords" and searchResultsLength=$searchResultsLength', ({ keywords, searchResultsLength }) => {
      // Arrange
      const props = createDefaultProps({ keywords, searchResultsLength })

      // Act
      render(<FileList {...props} />)

      // Assert
      const input = screen.getByPlaceholderText('datasetPipeline.onlineDrive.breadcrumbs.searchPlaceholder')
      expect(input).toHaveValue(keywords)
    })
  })

  // ==========================================
  // File Type Variations
  // ==========================================
  describe('File Type Variations', () => {
    it('should render folder type correctly', () => {
      // Arrange
      const fileList = [createMockOnlineDriveFile({ id: 'folder-1', name: 'my-folder', type: OnlineDriveFileType.folder })]
      const props = createDefaultProps({ fileList })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText('my-folder')).toBeInTheDocument()
    })

    it('should render bucket type correctly', () => {
      // Arrange
      const fileList = [createMockOnlineDriveFile({ id: 'bucket-1', name: 'my-bucket', type: OnlineDriveFileType.bucket })]
      const props = createDefaultProps({ fileList })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText('my-bucket')).toBeInTheDocument()
    })

    it('should render file with size', () => {
      // Arrange
      const fileList = [createMockOnlineDriveFile({ id: 'file-1', name: 'test.txt', size: 1024 })]
      const props = createDefaultProps({ fileList })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText('test.txt')).toBeInTheDocument()
      // formatFileSize returns '1.00 KB' for 1024 bytes
      expect(screen.getByText('1.00 KB')).toBeInTheDocument()
    })

    it('should not show checkbox for bucket type', () => {
      // Arrange
      const fileList = [createMockOnlineDriveFile({ id: 'bucket-1', name: 'my-bucket', type: OnlineDriveFileType.bucket })]
      const props = createDefaultProps({ fileList, supportBatchUpload: true })

      // Act
      render(<FileList {...props} />)

      // Assert - No checkbox should be rendered for bucket
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })
  })

  // ==========================================
  // Search Results Display
  // ==========================================
  describe('Search Results Display', () => {
    it('should show search results count when keywords and results exist', () => {
      // Arrange
      const props = createDefaultProps({
        keywords: 'test',
        searchResultsLength: 5,
        breadcrumbs: ['folder1'],
      })

      // Act
      render(<FileList {...props} />)

      // Assert
      expect(screen.getByText(/datasetPipeline\.onlineDrive\.breadcrumbs\.searchResult/)).toBeInTheDocument()
    })
  })

  // ==========================================
  // Callback Stability
  // ==========================================
  describe('Callback Stability', () => {
    it('should maintain stable handleSelectFile callback', () => {
      // Arrange
      const mockHandleSelectFile = vi.fn()
      const fileList = [createMockOnlineDriveFile({ id: 'file-1', name: 'test.txt' })]
      const props = createDefaultProps({ handleSelectFile: mockHandleSelectFile, fileList })
      const { rerender } = render(<FileList {...props} />)

      // Act - Click once
      const fileItem = screen.getByText('test.txt')
      fireEvent.click(fileItem.closest('[class*="cursor-pointer"]')!)

      // Rerender with same props
      rerender(<FileList {...props} />)

      // Click again
      fireEvent.click(fileItem.closest('[class*="cursor-pointer"]')!)

      // Assert
      expect(mockHandleSelectFile).toHaveBeenCalledTimes(2)
    })

    it('should maintain stable handleOpenFolder callback', () => {
      // Arrange
      const mockHandleOpenFolder = vi.fn()
      const fileList = [createMockOnlineDriveFile({ id: 'folder-1', name: 'my-folder', type: OnlineDriveFileType.folder })]
      const props = createDefaultProps({ handleOpenFolder: mockHandleOpenFolder, fileList })
      const { rerender } = render(<FileList {...props} />)

      // Act - Click once
      const folderItem = screen.getByText('my-folder')
      fireEvent.click(folderItem.closest('[class*="cursor-pointer"]')!)

      // Rerender with same props
      rerender(<FileList {...props} />)

      // Click again
      fireEvent.click(folderItem.closest('[class*="cursor-pointer"]')!)

      // Assert
      expect(mockHandleOpenFolder).toHaveBeenCalledTimes(2)
    })
  })
})
