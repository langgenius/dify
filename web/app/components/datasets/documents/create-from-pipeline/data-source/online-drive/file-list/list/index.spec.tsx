import type { Mock } from 'vitest'
import type { OnlineDriveFile } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { OnlineDriveFileType } from '@/models/pipeline'
import List from './index'

// ==========================================
// Mock Modules
// ==========================================

// Note: react-i18next uses global mock from web/vitest.setup.ts

// Mock Item component for List tests - child component with complex behavior
vi.mock('./item', () => ({
  default: ({ file, isSelected, onSelect, onOpen, isMultipleChoice }: {
    file: OnlineDriveFile
    isSelected: boolean
    onSelect: (file: OnlineDriveFile) => void
    onOpen: (file: OnlineDriveFile) => void
    isMultipleChoice: boolean
  }) => {
    return (
      <div
        data-testid={`item-${file.id}`}
        data-selected={isSelected}
        data-multiple-choice={isMultipleChoice}
      >
        <span data-testid={`item-name-${file.id}`}>{file.name}</span>
        <button data-testid={`item-select-${file.id}`} onClick={() => onSelect(file)}>Select</button>
        <button data-testid={`item-open-${file.id}`} onClick={() => onOpen(file)}>Open</button>
      </div>
    )
  },
}))

// Mock EmptyFolder component for List tests
vi.mock('./empty-folder', () => ({
  default: () => (
    <div data-testid="empty-folder">Empty Folder</div>
  ),
}))

// Mock EmptySearchResult component for List tests
vi.mock('./empty-search-result', () => ({
  default: ({ onResetKeywords }: { onResetKeywords: () => void }) => (
    <div data-testid="empty-search-result">
      <span>No results</span>
      <button data-testid="reset-keywords-btn" onClick={onResetKeywords}>Reset</button>
    </div>
  ),
}))

// Mock store state and refs
const mockIsTruncated = { current: false }
const mockCurrentNextPageParametersRef = { current: {} as Record<string, any> }
const mockSetNextPageParameters = vi.fn()

const mockStoreState = {
  isTruncated: mockIsTruncated,
  currentNextPageParametersRef: mockCurrentNextPageParametersRef,
  setNextPageParameters: mockSetNextPageParameters,
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../../../store', () => ({
  useDataSourceStore: () => mockDataSourceStore,
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

const createMockFileList = (count: number): OnlineDriveFile[] => {
  return Array.from({ length: count }, (_, index) => createMockOnlineDriveFile({
    id: `file-${index + 1}`,
    name: `file-${index + 1}.txt`,
    size: (index + 1) * 1024,
  }))
}

type ListProps = React.ComponentProps<typeof List>

const createDefaultProps = (overrides?: Partial<ListProps>): ListProps => ({
  fileList: [],
  selectedFileIds: [],
  keywords: '',
  isLoading: false,
  supportBatchUpload: true,
  handleResetKeywords: vi.fn(),
  handleSelectFile: vi.fn(),
  handleOpenFolder: vi.fn(),
  ...overrides,
})

// ==========================================
// Mock IntersectionObserver
// ==========================================
let mockIntersectionObserverCallback: IntersectionObserverCallback | null = null
let mockIntersectionObserverInstance: {
  observe: Mock
  disconnect: Mock
  unobserve: Mock
} | null = null

const createMockIntersectionObserver = () => {
  const instance = {
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }
  mockIntersectionObserverInstance = instance

  return class MockIntersectionObserver {
    callback: IntersectionObserverCallback
    options: IntersectionObserverInit

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback
      this.options = options || {}
      mockIntersectionObserverCallback = callback
    }

    observe = instance.observe
    disconnect = instance.disconnect
    unobserve = instance.unobserve
  }
}

// ==========================================
// Helper Functions
// ==========================================
const triggerIntersection = (isIntersecting: boolean) => {
  if (mockIntersectionObserverCallback) {
    const entries = [{
      isIntersecting,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      target: document.createElement('div'),
      time: Date.now(),
    }] as IntersectionObserverEntry[]
    mockIntersectionObserverCallback(entries, {} as IntersectionObserver)
  }
}

const resetMockStoreState = () => {
  mockIsTruncated.current = false
  mockCurrentNextPageParametersRef.current = {}
  mockSetNextPageParameters.mockClear()
  mockGetState.mockClear()
}

// ==========================================
// Test Suites
// ==========================================
describe('List', () => {
  const originalIntersectionObserver = window.IntersectionObserver

  beforeEach(() => {
    vi.clearAllMocks()
    resetMockStoreState()
    mockIntersectionObserverCallback = null
    mockIntersectionObserverInstance = null

    // Setup IntersectionObserver mock
    window.IntersectionObserver = createMockIntersectionObserver() as unknown as typeof IntersectionObserver
  })

  afterEach(() => {
    window.IntersectionObserver = originalIntersectionObserver
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<List {...props} />)

      // Assert
      expect(document.body).toBeInTheDocument()
    })

    it('should render Loading component when isAllLoading is true', () => {
      // Arrange
      const props = createDefaultProps({
        isLoading: true,
        fileList: [],
        keywords: '',
      })

      // Act
      render(<List {...props} />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render EmptyFolder when folder is empty and not loading', () => {
      // Arrange
      const props = createDefaultProps({
        isLoading: false,
        fileList: [],
        keywords: '',
      })

      // Act
      render(<List {...props} />)

      // Assert
      expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
    })

    it('should render EmptySearchResult when search has no results', () => {
      // Arrange
      const props = createDefaultProps({
        isLoading: false,
        fileList: [],
        keywords: 'non-existent-file',
      })

      // Act
      render(<List {...props} />)

      // Assert
      expect(screen.getByTestId('empty-search-result')).toBeInTheDocument()
    })

    it('should render file list when files exist', () => {
      // Arrange
      const fileList = createMockFileList(3)
      const props = createDefaultProps({ fileList })

      // Act
      render(<List {...props} />)

      // Assert
      expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      expect(screen.getByTestId('item-file-2')).toBeInTheDocument()
      expect(screen.getByTestId('item-file-3')).toBeInTheDocument()
    })

    it('should render partial loading spinner when loading more files', () => {
      // Arrange
      const fileList = createMockFileList(2)
      const props = createDefaultProps({
        fileList,
        isLoading: true,
      })

      // Act
      render(<List {...props} />)

      // Assert - Should show files AND loading indicator
      expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('fileList prop', () => {
      it('should render all files from fileList', () => {
        // Arrange
        const fileList = createMockFileList(5)
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        fileList.forEach((file) => {
          expect(screen.getByTestId(`item-${file.id}`)).toBeInTheDocument()
          expect(screen.getByTestId(`item-name-${file.id}`)).toHaveTextContent(file.name)
        })
      })

      it('should handle empty fileList', () => {
        // Arrange
        const props = createDefaultProps({ fileList: [] })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
      })

      it('should handle single file in fileList', () => {
        // Arrange
        const fileList = [createMockOnlineDriveFile()]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      })

      it('should handle large fileList', () => {
        // Arrange
        const fileList = createMockFileList(100)
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
        expect(screen.getByTestId('item-file-100')).toBeInTheDocument()
      })
    })

    describe('selectedFileIds prop', () => {
      it('should mark selected files as selected', () => {
        // Arrange
        const fileList = createMockFileList(3)
        const props = createDefaultProps({
          fileList,
          selectedFileIds: ['file-1', 'file-3'],
        })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toHaveAttribute('data-selected', 'true')
        expect(screen.getByTestId('item-file-2')).toHaveAttribute('data-selected', 'false')
        expect(screen.getByTestId('item-file-3')).toHaveAttribute('data-selected', 'true')
      })

      it('should handle empty selectedFileIds', () => {
        // Arrange
        const fileList = createMockFileList(3)
        const props = createDefaultProps({
          fileList,
          selectedFileIds: [],
        })

        // Act
        render(<List {...props} />)

        // Assert
        fileList.forEach((file) => {
          expect(screen.getByTestId(`item-${file.id}`)).toHaveAttribute('data-selected', 'false')
        })
      })

      it('should handle all files selected', () => {
        // Arrange
        const fileList = createMockFileList(3)
        const props = createDefaultProps({
          fileList,
          selectedFileIds: ['file-1', 'file-2', 'file-3'],
        })

        // Act
        render(<List {...props} />)

        // Assert
        fileList.forEach((file) => {
          expect(screen.getByTestId(`item-${file.id}`)).toHaveAttribute('data-selected', 'true')
        })
      })
    })

    describe('keywords prop', () => {
      it('should show EmptySearchResult when keywords exist but no results', () => {
        // Arrange
        const props = createDefaultProps({
          fileList: [],
          keywords: 'search-term',
        })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('empty-search-result')).toBeInTheDocument()
      })

      it('should show EmptyFolder when keywords is empty and no files', () => {
        // Arrange
        const props = createDefaultProps({
          fileList: [],
          keywords: '',
        })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
      })
    })

    describe('isLoading prop', () => {
      it.each([
        { isLoading: true, fileList: [], keywords: '', expected: 'isAllLoading' },
        { isLoading: true, fileList: createMockFileList(2), keywords: '', expected: 'isPartialLoading' },
        { isLoading: false, fileList: [], keywords: '', expected: 'isEmpty' },
        { isLoading: false, fileList: createMockFileList(2), keywords: '', expected: 'hasFiles' },
      ])('should render correctly when isLoading=$isLoading with fileList.length=$fileList.length', ({ isLoading, fileList, expected }) => {
        // Arrange
        const props = createDefaultProps({ isLoading, fileList })

        // Act
        render(<List {...props} />)

        // Assert
        switch (expected) {
          case 'isAllLoading':
            expect(screen.getByRole('status')).toBeInTheDocument()
            break
          case 'isPartialLoading':
            expect(screen.getByRole('status')).toBeInTheDocument()
            expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
            break
          case 'isEmpty':
            expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
            break
          case 'hasFiles':
            expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
            break
        }
      })
    })

    describe('supportBatchUpload prop', () => {
      it('should pass supportBatchUpload true to Item components', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          supportBatchUpload: true,
        })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toHaveAttribute('data-multiple-choice', 'true')
      })

      it('should pass supportBatchUpload false to Item components', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          supportBatchUpload: false,
        })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toHaveAttribute('data-multiple-choice', 'false')
      })
    })
  })

  // ==========================================
  // User Interactions and Event Handlers
  // ==========================================
  describe('User Interactions', () => {
    describe('File Selection', () => {
      it('should call handleSelectFile when selecting a file', () => {
        // Arrange
        const handleSelectFile = vi.fn()
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          handleSelectFile,
        })
        render(<List {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('item-select-file-1'))

        // Assert
        expect(handleSelectFile).toHaveBeenCalledWith(fileList[0])
      })

      it('should call handleSelectFile with correct file data', () => {
        // Arrange
        const handleSelectFile = vi.fn()
        const fileList = [
          createMockOnlineDriveFile({ id: 'unique-id', name: 'special-file.pdf', size: 5000 }),
        ]
        const props = createDefaultProps({
          fileList,
          handleSelectFile,
        })
        render(<List {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('item-select-unique-id'))

        // Assert
        expect(handleSelectFile).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'unique-id',
            name: 'special-file.pdf',
            size: 5000,
          }),
        )
      })
    })

    describe('Folder Navigation', () => {
      it('should call handleOpenFolder when opening a folder', () => {
        // Arrange
        const handleOpenFolder = vi.fn()
        const fileList = [
          createMockOnlineDriveFile({ id: 'folder-1', name: 'Documents', type: OnlineDriveFileType.folder }),
        ]
        const props = createDefaultProps({
          fileList,
          handleOpenFolder,
        })
        render(<List {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('item-open-folder-1'))

        // Assert
        expect(handleOpenFolder).toHaveBeenCalledWith(fileList[0])
      })
    })

    describe('Reset Keywords', () => {
      it('should call handleResetKeywords when reset button is clicked', () => {
        // Arrange
        const handleResetKeywords = vi.fn()
        const props = createDefaultProps({
          fileList: [],
          keywords: 'search-term',
          handleResetKeywords,
        })
        render(<List {...props} />)

        // Act
        fireEvent.click(screen.getByTestId('reset-keywords-btn'))

        // Assert
        expect(handleResetKeywords).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ==========================================
  // Side Effects and Cleanup Tests (IntersectionObserver)
  // ==========================================
  describe('Side Effects and Cleanup', () => {
    describe('IntersectionObserver Setup', () => {
      it('should create IntersectionObserver on mount', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(mockIntersectionObserverInstance?.observe).toHaveBeenCalled()
      })

      it('should create IntersectionObserver with correct rootMargin', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert - Callback should be set
        expect(mockIntersectionObserverCallback).toBeDefined()
      })

      it('should observe the anchor element', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(mockIntersectionObserverInstance?.observe).toHaveBeenCalled()
        const observedElement = mockIntersectionObserverInstance?.observe.mock.calls[0]?.[0]
        expect(observedElement).toBeInstanceOf(HTMLElement)
        expect(observedElement as HTMLElement).toBeInTheDocument()
      })
    })

    describe('IntersectionObserver Callback', () => {
      it('should call setNextPageParameters when intersecting and truncated', async () => {
        // Arrange
        mockIsTruncated.current = true
        mockCurrentNextPageParametersRef.current = { cursor: 'next-cursor' }
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: false,
        })
        render(<List {...props} />)

        // Act
        triggerIntersection(true)

        // Assert
        await waitFor(() => {
          expect(mockSetNextPageParameters).toHaveBeenCalledWith({ cursor: 'next-cursor' })
        })
      })

      it('should not call setNextPageParameters when not intersecting', () => {
        // Arrange
        mockIsTruncated.current = true
        mockCurrentNextPageParametersRef.current = { cursor: 'next-cursor' }
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: false,
        })
        render(<List {...props} />)

        // Act
        triggerIntersection(false)

        // Assert
        expect(mockSetNextPageParameters).not.toHaveBeenCalled()
      })

      it('should not call setNextPageParameters when not truncated', () => {
        // Arrange
        mockIsTruncated.current = false
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: false,
        })
        render(<List {...props} />)

        // Act
        triggerIntersection(true)

        // Assert
        expect(mockSetNextPageParameters).not.toHaveBeenCalled()
      })

      it('should not call setNextPageParameters when loading', () => {
        // Arrange
        mockIsTruncated.current = true
        mockCurrentNextPageParametersRef.current = { cursor: 'next-cursor' }
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: true,
        })
        render(<List {...props} />)

        // Act
        triggerIntersection(true)

        // Assert
        expect(mockSetNextPageParameters).not.toHaveBeenCalled()
      })
    })

    describe('IntersectionObserver Cleanup', () => {
      it('should disconnect IntersectionObserver on unmount', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({ fileList })
        const { unmount } = render(<List {...props} />)

        // Act
        unmount()

        // Assert
        expect(mockIntersectionObserverInstance?.disconnect).toHaveBeenCalled()
      })

      it('should cleanup previous observer when dependencies change', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: false,
        })
        const { rerender } = render(<List {...props} />)

        // Act - Trigger re-render with changed isLoading
        rerender(<List {...props} isLoading={true} />)

        // Assert - Previous observer should be disconnected
        expect(mockIntersectionObserverInstance?.disconnect).toHaveBeenCalled()
      })
    })
  })

  // ==========================================
  // Component Memoization Tests
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange & Assert
      // List component should have $$typeof symbol indicating memo wrapper
      expect(List).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })

    it('should not re-render when props are equal', () => {
      // Arrange
      const fileList = createMockFileList(2)
      const props = createDefaultProps({ fileList })
      const renderSpy = vi.fn()

      // Create a wrapper component to track renders
      const TestWrapper = ({ testProps }: { testProps: ListProps }) => {
        renderSpy()
        return <List {...testProps} />
      }

      const { rerender } = render(<TestWrapper testProps={props} />)
      const initialRenderCount = renderSpy.mock.calls.length

      // Act - Rerender with same props
      rerender(<TestWrapper testProps={props} />)

      // Assert - Should have rendered again (wrapper re-renders, but memo prevents List re-render)
      expect(renderSpy.mock.calls.length).toBe(initialRenderCount + 1)
    })

    it('should re-render when fileList changes', () => {
      // Arrange
      const fileList1 = createMockFileList(2)
      const fileList2 = createMockFileList(3)
      const props1 = createDefaultProps({ fileList: fileList1 })
      const props2 = createDefaultProps({ fileList: fileList2 })

      const { rerender } = render(<List {...props1} />)

      // Assert initial state
      expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      expect(screen.getByTestId('item-file-2')).toBeInTheDocument()
      expect(screen.queryByTestId('item-file-3')).not.toBeInTheDocument()

      // Act - Rerender with new fileList
      rerender(<List {...props2} />)

      // Assert - Should show new file
      expect(screen.getByTestId('item-file-3')).toBeInTheDocument()
    })

    it('should re-render when selectedFileIds changes', () => {
      // Arrange
      const fileList = createMockFileList(2)
      const props1 = createDefaultProps({ fileList, selectedFileIds: [] })
      const props2 = createDefaultProps({ fileList, selectedFileIds: ['file-1'] })

      const { rerender } = render(<List {...props1} />)

      // Assert initial state
      expect(screen.getByTestId('item-file-1')).toHaveAttribute('data-selected', 'false')

      // Act
      rerender(<List {...props2} />)

      // Assert
      expect(screen.getByTestId('item-file-1')).toHaveAttribute('data-selected', 'true')
    })

    it('should re-render when isLoading changes', () => {
      // Arrange
      const fileList = createMockFileList(2)
      const props1 = createDefaultProps({ fileList, isLoading: false })
      const props2 = createDefaultProps({ fileList, isLoading: true })

      const { rerender } = render(<List {...props1} />)

      // Assert initial state - no loading spinner
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      // Act
      rerender(<List {...props2} />)

      // Assert - loading spinner should appear
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    describe('Empty/Null Values', () => {
      it('should handle empty fileList array', () => {
        // Arrange
        const props = createDefaultProps({ fileList: [] })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
      })

      it('should handle empty selectedFileIds array', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          selectedFileIds: [],
        })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toHaveAttribute('data-selected', 'false')
      })

      it('should handle empty keywords string', () => {
        // Arrange
        const props = createDefaultProps({
          fileList: [],
          keywords: '',
        })

        // Act
        render(<List {...props} />)

        // Assert - Shows empty folder, not empty search result
        expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
        expect(screen.queryByTestId('empty-search-result')).not.toBeInTheDocument()
      })
    })

    describe('Boundary Conditions', () => {
      it('should handle very long file names', () => {
        // Arrange
        const longName = `${'a'.repeat(500)}.txt`
        const fileList = [createMockOnlineDriveFile({ name: longName })]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-name-file-1')).toHaveTextContent(longName)
      })

      it('should handle special characters in file names', () => {
        // Arrange
        const specialName = 'test<script>alert("xss")</script>.txt'
        const fileList = [createMockOnlineDriveFile({ name: specialName })]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-name-file-1')).toHaveTextContent(specialName)
      })

      it('should handle unicode characters in file names', () => {
        // Arrange
        const unicodeName = '文件_📁_ファイル.txt'
        const fileList = [createMockOnlineDriveFile({ name: unicodeName })]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-name-file-1')).toHaveTextContent(unicodeName)
      })

      it('should handle file with zero size', () => {
        // Arrange
        const fileList = [createMockOnlineDriveFile({ size: 0 })]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      })

      it('should handle file with undefined size', () => {
        // Arrange
        const fileList = [createMockOnlineDriveFile({ size: undefined })]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      })
    })

    describe('Different File Types', () => {
      it.each([
        { type: OnlineDriveFileType.file, name: 'document.pdf' },
        { type: OnlineDriveFileType.folder, name: 'Documents' },
        { type: OnlineDriveFileType.bucket, name: 'my-bucket' },
      ])('should render $type type correctly', ({ type, name }) => {
        // Arrange
        const fileList = [createMockOnlineDriveFile({ id: `item-${type}`, type, name })]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId(`item-item-${type}`)).toBeInTheDocument()
        expect(screen.getByTestId(`item-name-item-${type}`)).toHaveTextContent(name)
      })

      it('should handle mixed file types in list', () => {
        // Arrange
        const fileList = [
          createMockOnlineDriveFile({ id: 'file-1', type: OnlineDriveFileType.file, name: 'doc.pdf' }),
          createMockOnlineDriveFile({ id: 'folder-1', type: OnlineDriveFileType.folder, name: 'Documents' }),
          createMockOnlineDriveFile({ id: 'bucket-1', type: OnlineDriveFileType.bucket, name: 'my-bucket' }),
        ]
        const props = createDefaultProps({ fileList })

        // Act
        render(<List {...props} />)

        // Assert
        expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
        expect(screen.getByTestId('item-folder-1')).toBeInTheDocument()
        expect(screen.getByTestId('item-bucket-1')).toBeInTheDocument()
      })
    })

    describe('Loading States Transitions', () => {
      it('should transition from loading to empty folder', () => {
        // Arrange
        const props1 = createDefaultProps({ isLoading: true, fileList: [] })
        const props2 = createDefaultProps({ isLoading: false, fileList: [] })

        const { rerender } = render(<List {...props1} />)

        // Assert initial loading state
        expect(screen.getByRole('status')).toBeInTheDocument()

        // Act
        rerender(<List {...props2} />)

        // Assert
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
      })

      it('should transition from loading to file list', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props1 = createDefaultProps({ isLoading: true, fileList: [] })
        const props2 = createDefaultProps({ isLoading: false, fileList })

        const { rerender } = render(<List {...props1} />)

        // Assert initial loading state
        expect(screen.getByRole('status')).toBeInTheDocument()

        // Act
        rerender(<List {...props2} />)

        // Assert
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
      })

      it('should transition from partial loading to loaded', () => {
        // Arrange
        const fileList = createMockFileList(2)
        const props1 = createDefaultProps({ isLoading: true, fileList })
        const props2 = createDefaultProps({ isLoading: false, fileList })

        const { rerender } = render(<List {...props1} />)

        // Assert initial partial loading state
        expect(screen.getByRole('status')).toBeInTheDocument()

        // Act
        rerender(<List {...props2} />)

        // Assert
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
      })
    })

    describe('Store State Edge Cases', () => {
      it('should handle store state with empty next page parameters', () => {
        // Arrange
        mockIsTruncated.current = true
        mockCurrentNextPageParametersRef.current = {}
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: false,
        })
        render(<List {...props} />)

        // Act
        triggerIntersection(true)

        // Assert
        expect(mockSetNextPageParameters).toHaveBeenCalledWith({})
      })

      it('should handle store state with complex next page parameters', () => {
        // Arrange
        const complexParams = {
          cursor: 'abc123',
          page: 2,
          metadata: { nested: { value: true } },
        }
        mockIsTruncated.current = true
        mockCurrentNextPageParametersRef.current = complexParams
        const fileList = createMockFileList(2)
        const props = createDefaultProps({
          fileList,
          isLoading: false,
        })
        render(<List {...props} />)

        // Act
        triggerIntersection(true)

        // Assert
        expect(mockSetNextPageParameters).toHaveBeenCalledWith(complexParams)
      })
    })
  })

  // ==========================================
  // All Prop Variations Tests
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      { supportBatchUpload: true },
      { supportBatchUpload: false },
    ])('should render correctly with supportBatchUpload=$supportBatchUpload', ({ supportBatchUpload }) => {
      // Arrange
      const fileList = createMockFileList(2)
      const props = createDefaultProps({ fileList, supportBatchUpload })

      // Act
      render(<List {...props} />)

      // Assert
      expect(screen.getByTestId('item-file-1')).toHaveAttribute(
        'data-multiple-choice',
        String(supportBatchUpload),
      )
    })

    it.each([
      { isLoading: true, fileCount: 0, keywords: '', expectedState: 'all-loading' },
      { isLoading: true, fileCount: 5, keywords: '', expectedState: 'partial-loading' },
      { isLoading: false, fileCount: 0, keywords: '', expectedState: 'empty-folder' },
      { isLoading: false, fileCount: 0, keywords: 'search', expectedState: 'empty-search' },
      { isLoading: false, fileCount: 5, keywords: '', expectedState: 'file-list' },
    ])('should render $expectedState when isLoading=$isLoading, fileCount=$fileCount, keywords=$keywords', ({ isLoading, fileCount, keywords, expectedState }) => {
      // Arrange
      const fileList = createMockFileList(fileCount)
      const props = createDefaultProps({ fileList, isLoading, keywords })

      // Act
      render(<List {...props} />)

      // Assert
      switch (expectedState) {
        case 'all-loading':
          expect(screen.getByRole('status')).toBeInTheDocument()
          break
        case 'partial-loading':
          expect(screen.getByRole('status')).toBeInTheDocument()
          expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
          break
        case 'empty-folder':
          expect(screen.getByTestId('empty-folder')).toBeInTheDocument()
          break
        case 'empty-search':
          expect(screen.getByTestId('empty-search-result')).toBeInTheDocument()
          break
        case 'file-list':
          expect(screen.getByTestId('item-file-1')).toBeInTheDocument()
          break
      }
    })

    it.each([
      { selectedCount: 0, expectedSelected: [] },
      { selectedCount: 1, expectedSelected: ['file-1'] },
      { selectedCount: 3, expectedSelected: ['file-1', 'file-2', 'file-3'] },
    ])('should handle $selectedCount selected files', ({ expectedSelected }) => {
      // Arrange
      const fileList = createMockFileList(3)
      const props = createDefaultProps({
        fileList,
        selectedFileIds: expectedSelected,
      })

      // Act
      render(<List {...props} />)

      // Assert
      fileList.forEach((file) => {
        const isSelected = expectedSelected.includes(file.id)
        expect(screen.getByTestId(`item-${file.id}`)).toHaveAttribute('data-selected', String(isSelected))
      })
    })
  })

  // ==========================================
  // Accessibility Tests
  // ==========================================
  describe('Accessibility', () => {
    it('should allow interaction with reset keywords button in empty search state', () => {
      // Arrange
      const handleResetKeywords = vi.fn()
      const props = createDefaultProps({
        fileList: [],
        keywords: 'search-term',
        handleResetKeywords,
      })

      // Act
      render(<List {...props} />)
      const resetButton = screen.getByTestId('reset-keywords-btn')

      // Assert
      expect(resetButton).toBeInTheDocument()
      fireEvent.click(resetButton)
      expect(handleResetKeywords).toHaveBeenCalled()
    })
  })
})

// ==========================================
// EmptyFolder Component Tests (using actual component)
// ==========================================
describe('EmptyFolder', () => {
  // Get real component for testing
  let ActualEmptyFolder: React.ComponentType

  beforeAll(async () => {
    const mod = await vi.importActual<{ default: React.ComponentType }>('./empty-folder')
    ActualEmptyFolder = mod.default
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ActualEmptyFolder />)
      expect(document.body).toBeInTheDocument()
    })

    it('should render empty folder message', () => {
      render(<ActualEmptyFolder />)
      expect(screen.getByText(/datasetPipeline\.onlineDrive\.emptyFolder/)).toBeInTheDocument()
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(ActualEmptyFolder).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })
  })

  describe('Accessibility', () => {
    it('should have readable text content', () => {
      render(<ActualEmptyFolder />)
      const textElement = screen.getByText(/datasetPipeline\.onlineDrive\.emptyFolder/)
      expect(textElement.tagName).toBe('SPAN')
    })
  })
})

// ==========================================
// EmptySearchResult Component Tests (using actual component)
// ==========================================
describe('EmptySearchResult', () => {
  // Get real component for testing
  let ActualEmptySearchResult: React.ComponentType<{ onResetKeywords: () => void }>

  beforeAll(async () => {
    const mod = await vi.importActual<{ default: React.ComponentType<{ onResetKeywords: () => void }> }>('./empty-search-result')
    ActualEmptySearchResult = mod.default
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const onResetKeywords = vi.fn()
      render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
      expect(document.body).toBeInTheDocument()
    })

    it('should render empty search result message', () => {
      const onResetKeywords = vi.fn()
      render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
      expect(screen.getByText(/datasetPipeline\.onlineDrive\.emptySearchResult/)).toBeInTheDocument()
    })

    it('should render reset keywords button', () => {
      const onResetKeywords = vi.fn()
      render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/datasetPipeline\.onlineDrive\.resetKeywords/)).toBeInTheDocument()
    })

    it('should render search icon', () => {
      const onResetKeywords = vi.fn()
      const { container } = render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
      const svgElement = container.querySelector('svg')
      expect(svgElement).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('onResetKeywords prop', () => {
      it('should call onResetKeywords when button is clicked', () => {
        const onResetKeywords = vi.fn()
        render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onResetKeywords).toHaveBeenCalledTimes(1)
      })

      it('should call onResetKeywords on each click', () => {
        const onResetKeywords = vi.fn()
        render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
        const button = screen.getByRole('button')
        fireEvent.click(button)
        fireEvent.click(button)
        fireEvent.click(button)
        expect(onResetKeywords).toHaveBeenCalledTimes(3)
      })
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(ActualEmptySearchResult).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })
  })

  describe('Accessibility', () => {
    it('should have accessible button', () => {
      const onResetKeywords = vi.fn()
      render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should have readable text content', () => {
      const onResetKeywords = vi.fn()
      render(<ActualEmptySearchResult onResetKeywords={onResetKeywords} />)
      expect(screen.getByText(/datasetPipeline\.onlineDrive\.emptySearchResult/)).toBeInTheDocument()
    })
  })
})

// ==========================================
// FileIcon Component Tests (using actual component)
// ==========================================
describe('FileIcon', () => {
  // Get real component for testing
  type FileIconProps = { type: OnlineDriveFileType, fileName: string, size?: 'sm' | 'md' | 'lg' | 'xl', className?: string }
  let ActualFileIcon: React.ComponentType<FileIconProps>

  beforeAll(async () => {
    const mod = await vi.importActual<{ default: React.ComponentType<FileIconProps> }>('./file-icon')
    ActualFileIcon = mod.default
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName="test.txt" />,
      )
      expect(container).toBeInTheDocument()
    })

    it('should render bucket icon for bucket type', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.bucket} fileName="my-bucket" />,
      )
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render folder icon for folder type', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.folder} fileName="Documents" />,
      )
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render file type icon for file type', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName="document.pdf" />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('type prop', () => {
      it.each([
        { type: OnlineDriveFileType.bucket, fileName: 'bucket-name' },
        { type: OnlineDriveFileType.folder, fileName: 'folder-name' },
        { type: OnlineDriveFileType.file, fileName: 'file.txt' },
      ])('should render correctly for type=$type', ({ type, fileName }) => {
        const { container } = render(
          <ActualFileIcon type={type} fileName={fileName} />,
        )
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    describe('fileName prop', () => {
      it.each([
        { fileName: 'document.pdf' },
        { fileName: 'image.png' },
        { fileName: 'video.mp4' },
        { fileName: 'audio.mp3' },
        { fileName: 'code.json' },
        { fileName: 'readme.md' },
        { fileName: 'data.xlsx' },
        { fileName: 'doc.docx' },
        { fileName: 'slides.pptx' },
        { fileName: 'unknown.xyz' },
      ])('should render icon for $fileName', ({ fileName }) => {
        const { container } = render(
          <ActualFileIcon type={OnlineDriveFileType.file} fileName={fileName} />,
        )
        expect(container.firstChild).toBeInTheDocument()
      })
    })

    describe('size prop', () => {
      it.each(['sm', 'md', 'lg', 'xl'] as const)('should accept size=%s', (size) => {
        const { container } = render(
          <ActualFileIcon type={OnlineDriveFileType.file} fileName="test.pdf" size={size} />,
        )
        expect(container.firstChild).toBeInTheDocument()
      })

      it('should default to md size', () => {
        const { container } = render(
          <ActualFileIcon type={OnlineDriveFileType.file} fileName="test.pdf" />,
        )
        expect(container.firstChild).toBeInTheDocument()
      })
    })
  })

  describe('Icon Type Determination', () => {
    it('should render bucket icon regardless of fileName', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.bucket} fileName="file.pdf" />,
      )
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render folder icon regardless of fileName', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.folder} fileName="document.pdf" />,
      )
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should determine file type based on fileName extension', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName="image.gif" />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(ActualFileIcon).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty fileName', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName="" />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle fileName without extension', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName="README" />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle special characters in fileName', () => {
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName="文件 (1).pdf" />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle very long fileName', () => {
      const longFileName = `${'a'.repeat(500)}.pdf`
      const { container } = render(
        <ActualFileIcon type={OnlineDriveFileType.file} fileName={longFileName} />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})

// ==========================================
// Item Component Tests (using actual component)
// ==========================================
describe('Item', () => {
  // Get real component for testing
  let ActualItem: React.ComponentType<ItemProps>

  type ItemProps = {
    file: OnlineDriveFile
    isSelected: boolean
    disabled?: boolean
    isMultipleChoice?: boolean
    onSelect: (file: OnlineDriveFile) => void
    onOpen: (file: OnlineDriveFile) => void
  }

  beforeAll(async () => {
    const mod = await vi.importActual<{ default: React.ComponentType<ItemProps> }>('./item')
    ActualItem = mod.default
  })

  // Reuse createMockOnlineDriveFile from outer scope
  const createItemProps = (overrides?: Partial<ItemProps>): ItemProps => ({
    file: createMockOnlineDriveFile(),
    isSelected: false,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  })

  // Helper to find custom checkbox element (div-based implementation)
  const findCheckbox = (container: HTMLElement) => container.querySelector('[data-testid^="checkbox-"]')
  const getRadio = () => screen.getByRole('radio')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createItemProps()
      render(<ActualItem {...props} />)
      expect(screen.getByText('test-file.txt')).toBeInTheDocument()
    })

    it('should render file name', () => {
      const props = createItemProps({
        file: createMockOnlineDriveFile({ name: 'document.pdf' }),
      })
      render(<ActualItem {...props} />)
      expect(screen.getByText('document.pdf')).toBeInTheDocument()
    })

    it('should render file size for file type', () => {
      const props = createItemProps({
        file: createMockOnlineDriveFile({ size: 1024, type: OnlineDriveFileType.file }),
      })
      render(<ActualItem {...props} />)
      expect(screen.getByText('1.00 KB')).toBeInTheDocument()
    })

    it('should not render file size for folder type', () => {
      const props = createItemProps({
        file: createMockOnlineDriveFile({ size: 1024, type: OnlineDriveFileType.folder, name: 'Documents' }),
      })
      render(<ActualItem {...props} />)
      expect(screen.queryByText('1 KB')).not.toBeInTheDocument()
    })

    it('should render checkbox in multiple choice mode for file', () => {
      const props = createItemProps({
        isMultipleChoice: true,
        file: createMockOnlineDriveFile({ type: OnlineDriveFileType.file }),
      })
      const { container } = render(<ActualItem {...props} />)
      expect(findCheckbox(container)).toBeInTheDocument()
    })

    it('should render radio in single choice mode for file', () => {
      const props = createItemProps({
        isMultipleChoice: false,
        file: createMockOnlineDriveFile({ type: OnlineDriveFileType.file }),
      })
      render(<ActualItem {...props} />)
      expect(getRadio()).toBeInTheDocument()
    })

    it('should not render checkbox or radio for bucket type', () => {
      const props = createItemProps({
        file: createMockOnlineDriveFile({ type: OnlineDriveFileType.bucket, name: 'my-bucket' }),
        isMultipleChoice: true,
      })
      const { container } = render(<ActualItem {...props} />)
      expect(findCheckbox(container)).not.toBeInTheDocument()
      expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    })

    it('should render with title attribute for file name', () => {
      const props = createItemProps({
        file: createMockOnlineDriveFile({ name: 'very-long-file-name.txt' }),
      })
      render(<ActualItem {...props} />)
      expect(screen.getByTitle('very-long-file-name.txt')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    describe('isSelected prop', () => {
      it('should show checkbox as checked when isSelected is true', () => {
        const props = createItemProps({ isSelected: true, isMultipleChoice: true })
        const { container } = render(<ActualItem {...props} />)
        const checkbox = findCheckbox(container)
        // Checked checkbox shows check icon
        expect(checkbox?.querySelector('[data-testid^="check-icon-"]')).toBeInTheDocument()
      })

      it('should show checkbox as unchecked when isSelected is false', () => {
        const props = createItemProps({ isSelected: false, isMultipleChoice: true })
        const { container } = render(<ActualItem {...props} />)
        const checkbox = findCheckbox(container)
        // Unchecked checkbox has no check icon
        expect(checkbox?.querySelector('[data-testid^="check-icon-"]')).not.toBeInTheDocument()
      })

      it('should show radio as checked when isSelected is true', () => {
        const props = createItemProps({ isSelected: true, isMultipleChoice: false })
        render(<ActualItem {...props} />)
        const radio = getRadio()
        expect(radio).toHaveAttribute('aria-checked', 'true')
      })
    })

    describe('disabled prop', () => {
      it('should not call onSelect when clicking disabled checkbox', () => {
        const onSelect = vi.fn()
        const props = createItemProps({ disabled: true, isMultipleChoice: true, onSelect })
        const { container } = render(<ActualItem {...props} />)
        const checkbox = findCheckbox(container)
        fireEvent.click(checkbox!)
        expect(onSelect).not.toHaveBeenCalled()
      })

      it('should not call onSelect when clicking disabled radio', () => {
        const onSelect = vi.fn()
        const props = createItemProps({ disabled: true, isMultipleChoice: false, onSelect })
        render(<ActualItem {...props} />)
        const radio = getRadio()
        fireEvent.click(radio)
        expect(onSelect).not.toHaveBeenCalled()
      })
    })

    describe('isMultipleChoice prop', () => {
      it('should default to true', () => {
        const props = createItemProps()
        delete (props as Partial<ItemProps>).isMultipleChoice
        const { container } = render(<ActualItem {...props} />)
        expect(findCheckbox(container)).toBeInTheDocument()
      })

      it('should render checkbox when true', () => {
        const props = createItemProps({ isMultipleChoice: true })
        const { container } = render(<ActualItem {...props} />)
        expect(findCheckbox(container)).toBeInTheDocument()
        expect(screen.queryByRole('radio')).not.toBeInTheDocument()
      })

      it('should render radio when false', () => {
        const props = createItemProps({ isMultipleChoice: false })
        const { container } = render(<ActualItem {...props} />)
        expect(getRadio()).toBeInTheDocument()
        expect(findCheckbox(container)).not.toBeInTheDocument()
      })
    })
  })

  describe('User Interactions', () => {
    describe('Click on Item', () => {
      it('should call onSelect when clicking on file item', () => {
        const onSelect = vi.fn()
        const file = createMockOnlineDriveFile({ type: OnlineDriveFileType.file })
        const props = createItemProps({ file, onSelect })
        render(<ActualItem {...props} />)
        fireEvent.click(screen.getByText('test-file.txt'))
        expect(onSelect).toHaveBeenCalledWith(file)
      })

      it('should call onOpen when clicking on folder item', () => {
        const onOpen = vi.fn()
        const file = createMockOnlineDriveFile({ type: OnlineDriveFileType.folder, name: 'Documents' })
        const props = createItemProps({ file, onOpen })
        render(<ActualItem {...props} />)
        fireEvent.click(screen.getByText('Documents'))
        expect(onOpen).toHaveBeenCalledWith(file)
      })

      it('should call onOpen when clicking on bucket item', () => {
        const onOpen = vi.fn()
        const file = createMockOnlineDriveFile({ type: OnlineDriveFileType.bucket, name: 'my-bucket' })
        const props = createItemProps({ file, onOpen })
        render(<ActualItem {...props} />)
        fireEvent.click(screen.getByText('my-bucket'))
        expect(onOpen).toHaveBeenCalledWith(file)
      })

      it('should not call any handler when clicking disabled item', () => {
        const onSelect = vi.fn()
        const onOpen = vi.fn()
        const props = createItemProps({ disabled: true, onSelect, onOpen })
        render(<ActualItem {...props} />)
        fireEvent.click(screen.getByText('test-file.txt'))
        expect(onSelect).not.toHaveBeenCalled()
        expect(onOpen).not.toHaveBeenCalled()
      })
    })

    describe('Click on Checkbox/Radio', () => {
      it('should call onSelect when clicking checkbox', () => {
        const onSelect = vi.fn()
        const file = createMockOnlineDriveFile()
        const props = createItemProps({ file, onSelect, isMultipleChoice: true })
        const { container } = render(<ActualItem {...props} />)
        const checkbox = findCheckbox(container)
        fireEvent.click(checkbox!)
        expect(onSelect).toHaveBeenCalledWith(file)
      })

      it('should call onSelect when clicking radio', () => {
        const onSelect = vi.fn()
        const file = createMockOnlineDriveFile()
        const props = createItemProps({ file, onSelect, isMultipleChoice: false })
        render(<ActualItem {...props} />)
        const radio = getRadio()
        fireEvent.click(radio)
        expect(onSelect).toHaveBeenCalledWith(file)
      })

      it('should stop event propagation when clicking checkbox', () => {
        const onSelect = vi.fn()
        const file = createMockOnlineDriveFile()
        const props = createItemProps({ file, onSelect, isMultipleChoice: true })
        const { container } = render(<ActualItem {...props} />)
        const checkbox = findCheckbox(container)
        fireEvent.click(checkbox!)
        expect(onSelect).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(ActualItem).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty file name', () => {
      const props = createItemProps({ file: createMockOnlineDriveFile({ name: '' }) })
      render(<ActualItem {...props} />)
      expect(document.body).toBeInTheDocument()
    })

    it('should handle very long file name', () => {
      const longName = `${'a'.repeat(500)}.txt`
      const props = createItemProps({ file: createMockOnlineDriveFile({ name: longName }) })
      render(<ActualItem {...props} />)
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle special characters in file name', () => {
      const specialName = '文件 <test> (1).pdf'
      const props = createItemProps({ file: createMockOnlineDriveFile({ name: specialName }) })
      render(<ActualItem {...props} />)
      expect(screen.getByText(specialName)).toBeInTheDocument()
    })

    it('should handle zero file size', () => {
      const props = createItemProps({ file: createMockOnlineDriveFile({ size: 0 }) })
      render(<ActualItem {...props} />)
      // formatFileSize returns 0 for size 0
      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle very large file size', () => {
      const props = createItemProps({ file: createMockOnlineDriveFile({ size: 1024 * 1024 * 1024 * 5 }) })
      render(<ActualItem {...props} />)
      expect(screen.getByText('5.00 GB')).toBeInTheDocument()
    })
  })
})

// ==========================================
// Utils Tests
// ==========================================
describe('utils', () => {
  // Import actual utils functions
  let getFileExtension: (filename: string) => string
  let getFileType: (filename: string) => string
  let FileAppearanceTypeEnum: Record<string, string>

  beforeAll(async () => {
    const utils = await vi.importActual<{ getFileExtension: typeof getFileExtension, getFileType: typeof getFileType }>('./utils')
    const types = await vi.importActual<{ FileAppearanceTypeEnum: typeof FileAppearanceTypeEnum }>('@/app/components/base/file-uploader/types')
    getFileExtension = utils.getFileExtension
    getFileType = utils.getFileType
    FileAppearanceTypeEnum = types.FileAppearanceTypeEnum
  })

  describe('getFileExtension', () => {
    describe('Basic Functionality', () => {
      it('should return file extension for normal file names', () => {
        expect(getFileExtension('document.pdf')).toBe('pdf')
        expect(getFileExtension('image.PNG')).toBe('png')
        expect(getFileExtension('data.JSON')).toBe('json')
      })

      it('should return lowercase extension', () => {
        expect(getFileExtension('FILE.PDF')).toBe('pdf')
        expect(getFileExtension('IMAGE.JPEG')).toBe('jpeg')
        expect(getFileExtension('Doc.TXT')).toBe('txt')
      })

      it('should handle multiple dots in filename', () => {
        expect(getFileExtension('file.backup.tar.gz')).toBe('gz')
        expect(getFileExtension('my.document.v2.pdf')).toBe('pdf')
        expect(getFileExtension('test.spec.ts')).toBe('ts')
      })
    })

    describe('Edge Cases', () => {
      it('should return empty string for empty filename', () => {
        expect(getFileExtension('')).toBe('')
      })

      it('should return empty string for filename without extension', () => {
        expect(getFileExtension('README')).toBe('')
        expect(getFileExtension('Makefile')).toBe('')
      })

      it('should return empty string for hidden files without extension', () => {
        expect(getFileExtension('.gitignore')).toBe('')
        expect(getFileExtension('.env')).toBe('')
      })

      it('should handle hidden files with extension', () => {
        expect(getFileExtension('.eslintrc.json')).toBe('json')
        expect(getFileExtension('.config.yaml')).toBe('yaml')
      })

      it('should handle files ending with dot', () => {
        expect(getFileExtension('file.')).toBe('')
      })

      it('should handle special characters in filename', () => {
        expect(getFileExtension('file-name_v1.0.pdf')).toBe('pdf')
        expect(getFileExtension('data (1).xlsx')).toBe('xlsx')
      })
    })

    describe('Boundary Conditions', () => {
      it('should handle very long file extensions', () => {
        expect(getFileExtension('file.verylongextension')).toBe('verylongextension')
      })

      it('should handle single character extensions', () => {
        expect(getFileExtension('file.a')).toBe('a')
        expect(getFileExtension('data.c')).toBe('c')
      })

      it('should handle numeric extensions', () => {
        expect(getFileExtension('file.001')).toBe('001')
        expect(getFileExtension('backup.123')).toBe('123')
      })
    })
  })

  describe('getFileType', () => {
    describe('Image Files', () => {
      it('should return gif type for gif files', () => {
        expect(getFileType('animation.gif')).toBe(FileAppearanceTypeEnum.gif)
        expect(getFileType('image.GIF')).toBe(FileAppearanceTypeEnum.gif)
      })

      it('should return image type for common image formats', () => {
        expect(getFileType('photo.jpg')).toBe(FileAppearanceTypeEnum.image)
        expect(getFileType('photo.jpeg')).toBe(FileAppearanceTypeEnum.image)
        expect(getFileType('photo.png')).toBe(FileAppearanceTypeEnum.image)
        expect(getFileType('photo.webp')).toBe(FileAppearanceTypeEnum.image)
        expect(getFileType('photo.svg')).toBe(FileAppearanceTypeEnum.image)
      })
    })

    describe('Video Files', () => {
      it('should return video type for video formats', () => {
        expect(getFileType('movie.mp4')).toBe(FileAppearanceTypeEnum.video)
        expect(getFileType('clip.mov')).toBe(FileAppearanceTypeEnum.video)
        expect(getFileType('video.webm')).toBe(FileAppearanceTypeEnum.video)
        expect(getFileType('recording.mpeg')).toBe(FileAppearanceTypeEnum.video)
      })
    })

    describe('Audio Files', () => {
      it('should return audio type for audio formats', () => {
        expect(getFileType('song.mp3')).toBe(FileAppearanceTypeEnum.audio)
        expect(getFileType('podcast.wav')).toBe(FileAppearanceTypeEnum.audio)
        expect(getFileType('audio.m4a')).toBe(FileAppearanceTypeEnum.audio)
        expect(getFileType('music.mpga')).toBe(FileAppearanceTypeEnum.audio)
      })
    })

    describe('Code Files', () => {
      it('should return code type for code-related formats', () => {
        expect(getFileType('page.html')).toBe(FileAppearanceTypeEnum.code)
        expect(getFileType('page.htm')).toBe(FileAppearanceTypeEnum.code)
        expect(getFileType('config.xml')).toBe(FileAppearanceTypeEnum.code)
        expect(getFileType('data.json')).toBe(FileAppearanceTypeEnum.code)
      })
    })

    describe('Document Files', () => {
      it('should return pdf type for PDF files', () => {
        expect(getFileType('document.pdf')).toBe(FileAppearanceTypeEnum.pdf)
        expect(getFileType('report.PDF')).toBe(FileAppearanceTypeEnum.pdf)
      })

      it('should return markdown type for markdown files', () => {
        expect(getFileType('README.md')).toBe(FileAppearanceTypeEnum.markdown)
        expect(getFileType('doc.markdown')).toBe(FileAppearanceTypeEnum.markdown)
        expect(getFileType('guide.mdx')).toBe(FileAppearanceTypeEnum.markdown)
      })

      it('should return excel type for spreadsheet files', () => {
        expect(getFileType('data.xlsx')).toBe(FileAppearanceTypeEnum.excel)
        expect(getFileType('data.xls')).toBe(FileAppearanceTypeEnum.excel)
        expect(getFileType('data.csv')).toBe(FileAppearanceTypeEnum.excel)
      })

      it('should return word type for Word documents', () => {
        expect(getFileType('document.docx')).toBe(FileAppearanceTypeEnum.word)
        expect(getFileType('document.doc')).toBe(FileAppearanceTypeEnum.word)
      })

      it('should return ppt type for PowerPoint files', () => {
        expect(getFileType('presentation.pptx')).toBe(FileAppearanceTypeEnum.ppt)
        expect(getFileType('slides.ppt')).toBe(FileAppearanceTypeEnum.ppt)
      })

      it('should return document type for text files', () => {
        expect(getFileType('notes.txt')).toBe(FileAppearanceTypeEnum.document)
      })
    })

    describe('Unknown Files', () => {
      it('should return custom type for unknown extensions', () => {
        expect(getFileType('file.xyz')).toBe(FileAppearanceTypeEnum.custom)
        expect(getFileType('data.unknown')).toBe(FileAppearanceTypeEnum.custom)
        expect(getFileType('binary.bin')).toBe(FileAppearanceTypeEnum.custom)
      })

      it('should return custom type for files without extension', () => {
        expect(getFileType('README')).toBe(FileAppearanceTypeEnum.custom)
        expect(getFileType('Makefile')).toBe(FileAppearanceTypeEnum.custom)
      })

      it('should return custom type for empty filename', () => {
        expect(getFileType('')).toBe(FileAppearanceTypeEnum.custom)
      })
    })

    describe('Case Insensitivity', () => {
      it('should handle uppercase extensions', () => {
        expect(getFileType('file.PDF')).toBe(FileAppearanceTypeEnum.pdf)
        expect(getFileType('file.DOCX')).toBe(FileAppearanceTypeEnum.word)
        expect(getFileType('file.XLSX')).toBe(FileAppearanceTypeEnum.excel)
      })

      it('should handle mixed case extensions', () => {
        expect(getFileType('file.Pdf')).toBe(FileAppearanceTypeEnum.pdf)
        expect(getFileType('file.DocX')).toBe(FileAppearanceTypeEnum.word)
      })
    })
  })
})
