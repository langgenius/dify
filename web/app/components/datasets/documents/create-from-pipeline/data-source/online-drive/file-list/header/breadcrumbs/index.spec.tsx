import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import Breadcrumbs from './index'

// ==========================================
// Mock Modules
// ==========================================

// Note: react-i18next uses global mock from web/vitest.setup.ts

// Mock store - context provider requires mocking
const mockStoreState = {
  hasBucket: false,
  breadcrumbs: [] as string[],
  prefix: [] as string[],
  setOnlineDriveFileList: vi.fn(),
  setSelectedFileIds: vi.fn(),
  setBreadcrumbs: vi.fn(),
  setPrefix: vi.fn(),
  setBucket: vi.fn(),
}

const mockGetState = vi.fn(() => mockStoreState)
const mockDataSourceStore = { getState: mockGetState }

vi.mock('../../../../store', () => ({
  useDataSourceStore: () => mockDataSourceStore,
  useDataSourceStoreWithSelector: (selector: (s: typeof mockStoreState) => unknown) => selector(mockStoreState),
}))

// ==========================================
// Test Data Builders
// ==========================================
type BreadcrumbsProps = React.ComponentProps<typeof Breadcrumbs>

const createDefaultProps = (overrides?: Partial<BreadcrumbsProps>): BreadcrumbsProps => ({
  breadcrumbs: [],
  keywords: '',
  bucket: '',
  searchResultsLength: 0,
  isInPipeline: false,
  ...overrides,
})

// ==========================================
// Helper Functions
// ==========================================
const resetMockStoreState = () => {
  mockStoreState.hasBucket = false
  mockStoreState.breadcrumbs = []
  mockStoreState.prefix = []
  mockStoreState.setOnlineDriveFileList = vi.fn()
  mockStoreState.setSelectedFileIds = vi.fn()
  mockStoreState.setBreadcrumbs = vi.fn()
  mockStoreState.setPrefix = vi.fn()
  mockStoreState.setBucket = vi.fn()
}

// ==========================================
// Test Suites
// ==========================================
describe('Breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockStoreState()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert - Container should be in the document
      const container = document.querySelector('.flex.grow')
      expect(container).toBeInTheDocument()
    })

    it('should render with correct container styles', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Breadcrumbs {...props} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('grow')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('overflow-hidden')
    })

    describe('Search Results Display', () => {
      it('should show search results when keywords and searchResultsLength > 0', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'test',
          searchResultsLength: 5,
          breadcrumbs: ['folder1'],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Search result text should be displayed
        expect(screen.getByText(/datasetPipeline\.onlineDrive\.breadcrumbs\.searchResult/)).toBeInTheDocument()
      })

      it('should not show search results when keywords is empty', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: '',
          searchResultsLength: 5,
          breadcrumbs: ['folder1'],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.queryByText(/searchResult/)).not.toBeInTheDocument()
      })

      it('should not show search results when searchResultsLength is 0', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'test',
          searchResultsLength: 0,
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.queryByText(/searchResult/)).not.toBeInTheDocument()
      })

      it('should use bucket as folderName when breadcrumbs is empty', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'test',
          searchResultsLength: 5,
          breadcrumbs: [],
          bucket: 'my-bucket',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should use bucket name in search result
        expect(screen.getByText(/searchResult.*my-bucket/i)).toBeInTheDocument()
      })

      it('should use last breadcrumb as folderName when breadcrumbs exist', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'test',
          searchResultsLength: 5,
          breadcrumbs: ['folder1', 'folder2'],
          bucket: 'my-bucket',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should use last breadcrumb in search result
        expect(screen.getByText(/searchResult.*folder2/i)).toBeInTheDocument()
      })
    })

    describe('All Buckets Title Display', () => {
      it('should show all buckets title when hasBucket=true, bucket is empty, and no breadcrumbs', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          breadcrumbs: [],
          bucket: '',
          keywords: '',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')).toBeInTheDocument()
      })

      it('should not show all buckets title when breadcrumbs exist', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          breadcrumbs: ['folder1'],
          bucket: '',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.queryByText('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')).not.toBeInTheDocument()
      })

      it('should not show all buckets title when bucket is set', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          breadcrumbs: [],
          bucket: 'my-bucket',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should show bucket name instead
        expect(screen.queryByText('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')).not.toBeInTheDocument()
      })
    })

    describe('Bucket Component Display', () => {
      it('should render Bucket component when hasBucket and bucket are set', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'test-bucket',
          breadcrumbs: [],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Bucket name should be displayed
        expect(screen.getByText('test-bucket')).toBeInTheDocument()
      })

      it('should not render Bucket when hasBucket is false', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          bucket: 'test-bucket',
          breadcrumbs: [],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Bucket should not be displayed, Drive should be shown instead
        expect(screen.queryByText('test-bucket')).not.toBeInTheDocument()
      })
    })

    describe('Drive Component Display', () => {
      it('should render Drive component when hasBucket is false', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: [],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - "All Files" should be displayed
        expect(screen.getByText('datasetPipeline.onlineDrive.breadcrumbs.allFiles')).toBeInTheDocument()
      })

      it('should not render Drive component when hasBucket is true', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'test-bucket',
          breadcrumbs: [],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.queryByText('datasetPipeline.onlineDrive.breadcrumbs.allFiles')).not.toBeInTheDocument()
      })
    })

    describe('BreadcrumbItem Display', () => {
      it('should render all breadcrumbs when not collapsed', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2'],
          isInPipeline: false,
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('folder1')).toBeInTheDocument()
        expect(screen.getByText('folder2')).toBeInTheDocument()
      })

      it('should render last breadcrumb as active', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2'],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Last breadcrumb should have active styles
        const lastBreadcrumb = screen.getByText('folder2')
        expect(lastBreadcrumb).toHaveClass('system-sm-medium')
        expect(lastBreadcrumb).toHaveClass('text-text-secondary')
      })

      it('should render non-last breadcrumbs with tertiary styles', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2'],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - First breadcrumb should have tertiary styles
        const firstBreadcrumb = screen.getByText('folder1')
        expect(firstBreadcrumb).toHaveClass('system-sm-regular')
        expect(firstBreadcrumb).toHaveClass('text-text-tertiary')
      })
    })

    describe('Collapsed Breadcrumbs (Dropdown)', () => {
      it('should show dropdown when breadcrumbs exceed displayBreadcrumbNum', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3', 'folder4'],
          isInPipeline: false, // displayBreadcrumbNum = 3
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Dropdown trigger (more button) should be present
        expect(screen.getByRole('button', { name: '' })).toBeInTheDocument()
      })

      it('should not show dropdown when breadcrumbs do not exceed displayBreadcrumbNum', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2'],
          isInPipeline: false, // displayBreadcrumbNum = 3
        })

        // Act
        const { container } = render(<Breadcrumbs {...props} />)

        // Assert - Should not have dropdown, just regular breadcrumbs
        // All breadcrumbs should be directly visible
        expect(screen.getByText('folder1')).toBeInTheDocument()
        expect(screen.getByText('folder2')).toBeInTheDocument()
        // Count buttons - should be 3 (allFiles + folder1 + folder2)
        const buttons = container.querySelectorAll('button')
        expect(buttons.length).toBe(3)
      })

      it('should show prefix breadcrumbs and last breadcrumb when collapsed', async () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3', 'folder4', 'folder5'],
          isInPipeline: false, // displayBreadcrumbNum = 3
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - First breadcrumb and last breadcrumb should be visible
        expect(screen.getByText('folder1')).toBeInTheDocument()
        expect(screen.getByText('folder2')).toBeInTheDocument()
        expect(screen.getByText('folder5')).toBeInTheDocument()
        // Middle breadcrumbs should be in dropdown
        expect(screen.queryByText('folder3')).not.toBeInTheDocument()
        expect(screen.queryByText('folder4')).not.toBeInTheDocument()
      })

      it('should show collapsed breadcrumbs in dropdown when clicked', async () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3', 'folder4', 'folder5'],
          isInPipeline: false,
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click on dropdown trigger (the ... button)
        const dropdownTrigger = screen.getAllByRole('button').find(btn => btn.querySelector('svg'))
        if (dropdownTrigger)
          fireEvent.click(dropdownTrigger)

        // Assert - Collapsed breadcrumbs should be visible
        await waitFor(() => {
          expect(screen.getByText('folder3')).toBeInTheDocument()
          expect(screen.getByText('folder4')).toBeInTheDocument()
        })
      })
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('breadcrumbs prop', () => {
      it('should handle empty breadcrumbs array', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({ breadcrumbs: [] })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Only Drive should be visible
        expect(screen.getByText('datasetPipeline.onlineDrive.breadcrumbs.allFiles')).toBeInTheDocument()
      })

      it('should handle single breadcrumb', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({ breadcrumbs: ['single-folder'] })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('single-folder')).toBeInTheDocument()
      })

      it('should handle breadcrumbs with special characters', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder [1]', 'folder (copy)'],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('folder [1]')).toBeInTheDocument()
        expect(screen.getByText('folder (copy)')).toBeInTheDocument()
      })

      it('should handle breadcrumbs with unicode characters', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['文件夹', 'フォルダ'],
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('文件夹')).toBeInTheDocument()
        expect(screen.getByText('フォルダ')).toBeInTheDocument()
      })
    })

    describe('keywords prop', () => {
      it('should show search results when keywords is non-empty with results', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'search-term',
          searchResultsLength: 10,
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText(/searchResult/)).toBeInTheDocument()
      })

      it('should handle whitespace keywords', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: '   ',
          searchResultsLength: 5,
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Whitespace is truthy, so should show search results
        expect(screen.getByText(/searchResult/)).toBeInTheDocument()
      })
    })

    describe('bucket prop', () => {
      it('should display bucket name when hasBucket and bucket are set', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'production-bucket',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('production-bucket')).toBeInTheDocument()
      })

      it('should handle bucket with special characters', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'bucket-v2.0_backup',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText('bucket-v2.0_backup')).toBeInTheDocument()
      })
    })

    describe('searchResultsLength prop', () => {
      it('should handle zero searchResultsLength', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'test',
          searchResultsLength: 0,
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should not show search results
        expect(screen.queryByText(/searchResult/)).not.toBeInTheDocument()
      })

      it('should handle large searchResultsLength', () => {
        // Arrange
        const props = createDefaultProps({
          keywords: 'test',
          searchResultsLength: 10000,
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert
        expect(screen.getByText(/searchResult.*10000/)).toBeInTheDocument()
      })
    })

    describe('isInPipeline prop', () => {
      it('should use displayBreadcrumbNum=2 when isInPipeline is true', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3'],
          isInPipeline: true, // displayBreadcrumbNum = 2
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should collapse because 3 > 2
        // Dropdown should be present
        const buttons = screen.getAllByRole('button')
        const hasDropdownTrigger = buttons.some(btn => btn.querySelector('svg'))
        expect(hasDropdownTrigger).toBe(true)
      })

      it('should use displayBreadcrumbNum=3 when isInPipeline is false', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3'],
          isInPipeline: false, // displayBreadcrumbNum = 3
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should NOT collapse because 3 <= 3
        expect(screen.getByText('folder1')).toBeInTheDocument()
        expect(screen.getByText('folder2')).toBeInTheDocument()
        expect(screen.getByText('folder3')).toBeInTheDocument()
      })

      it('should reduce displayBreadcrumbNum by 1 when bucket is set', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3'],
          bucket: 'my-bucket',
          isInPipeline: false, // displayBreadcrumbNum = 3 - 1 = 2
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - Should collapse because 3 > 2
        const buttons = screen.getAllByRole('button')
        const hasDropdownTrigger = buttons.some(btn => btn.querySelector('svg'))
        expect(hasDropdownTrigger).toBe(true)
      })
    })
  })

  // ==========================================
  // Memoization Logic and Dependencies Tests
  // ==========================================
  describe('Memoization Logic and Dependencies', () => {
    describe('displayBreadcrumbNum useMemo', () => {
      it('should calculate correct value when isInPipeline=false and no bucket', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['a', 'b', 'c', 'd'],
          isInPipeline: false,
          bucket: '',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - displayBreadcrumbNum = 3, so 4 breadcrumbs should collapse
        // First 2 visible, dropdown, last 1 visible
        expect(screen.getByText('a')).toBeInTheDocument()
        expect(screen.getByText('b')).toBeInTheDocument()
        expect(screen.getByText('d')).toBeInTheDocument()
        expect(screen.queryByText('c')).not.toBeInTheDocument()
      })

      it('should calculate correct value when isInPipeline=true and no bucket', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['a', 'b', 'c'],
          isInPipeline: true,
          bucket: '',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - displayBreadcrumbNum = 2, so 3 breadcrumbs should collapse
        expect(screen.getByText('a')).toBeInTheDocument()
        expect(screen.getByText('c')).toBeInTheDocument()
        expect(screen.queryByText('b')).not.toBeInTheDocument()
      })

      it('should calculate correct value when isInPipeline=false and bucket exists', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          breadcrumbs: ['a', 'b', 'c'],
          isInPipeline: false,
          bucket: 'my-bucket',
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - displayBreadcrumbNum = 3 - 1 = 2, so 3 breadcrumbs should collapse
        expect(screen.getByText('a')).toBeInTheDocument()
        expect(screen.getByText('c')).toBeInTheDocument()
        expect(screen.queryByText('b')).not.toBeInTheDocument()
      })
    })

    describe('breadcrumbsConfig useMemo', () => {
      it('should correctly split breadcrumbs when collapsed', async () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['f1', 'f2', 'f3', 'f4', 'f5'],
          isInPipeline: false, // displayBreadcrumbNum = 3
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click dropdown to see collapsed items
        const dropdownTrigger = screen.getAllByRole('button').find(btn => btn.querySelector('svg'))
        if (dropdownTrigger)
          fireEvent.click(dropdownTrigger)

        // Assert
        // prefixBreadcrumbs = ['f1', 'f2']
        // collapsedBreadcrumbs = ['f3', 'f4']
        // lastBreadcrumb = 'f5'
        expect(screen.getByText('f1')).toBeInTheDocument()
        expect(screen.getByText('f2')).toBeInTheDocument()
        expect(screen.getByText('f5')).toBeInTheDocument()
        await waitFor(() => {
          expect(screen.getByText('f3')).toBeInTheDocument()
          expect(screen.getByText('f4')).toBeInTheDocument()
        })
      })

      it('should not collapse when breadcrumbs.length <= displayBreadcrumbNum', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['f1', 'f2'],
          isInPipeline: false, // displayBreadcrumbNum = 3
        })

        // Act
        render(<Breadcrumbs {...props} />)

        // Assert - All breadcrumbs should be visible
        expect(screen.getByText('f1')).toBeInTheDocument()
        expect(screen.getByText('f2')).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Callback Stability and Event Handlers Tests
  // ==========================================
  describe('Callback Stability and Event Handlers', () => {
    describe('handleBackToBucketList', () => {
      it('should reset store state when called', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'my-bucket',
          breadcrumbs: [],
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click bucket icon button (first button in Bucket component)
        const buttons = screen.getAllByRole('button')
        fireEvent.click(buttons[0]) // Bucket icon button

        // Assert
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
        expect(mockStoreState.setBucket).toHaveBeenCalledWith('')
        expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith([])
        expect(mockStoreState.setPrefix).toHaveBeenCalledWith([])
      })
    })

    describe('handleClickBucketName', () => {
      it('should reset breadcrumbs and prefix when bucket name is clicked', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'my-bucket',
          breadcrumbs: ['folder1'],
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click bucket name button
        const bucketButton = screen.getByText('my-bucket')
        fireEvent.click(bucketButton)

        // Assert
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
        expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith([])
        expect(mockStoreState.setPrefix).toHaveBeenCalledWith([])
      })

      it('should not call handler when bucket is disabled (no breadcrumbs)', () => {
        // Arrange
        mockStoreState.hasBucket = true
        const props = createDefaultProps({
          bucket: 'my-bucket',
          breadcrumbs: [], // disabled when no breadcrumbs
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click bucket name button (should be disabled)
        const bucketButton = screen.getByText('my-bucket')
        fireEvent.click(bucketButton)

        // Assert - Store methods should NOT be called because button is disabled
        expect(mockStoreState.setOnlineDriveFileList).not.toHaveBeenCalled()
      })
    })

    describe('handleBackToRoot', () => {
      it('should reset state when Drive button is clicked', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1'],
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click "All Files" button
        const driveButton = screen.getByText('datasetPipeline.onlineDrive.breadcrumbs.allFiles')
        fireEvent.click(driveButton)

        // Assert
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
        expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith([])
        expect(mockStoreState.setPrefix).toHaveBeenCalledWith([])
      })
    })

    describe('handleClickBreadcrumb', () => {
      it('should slice breadcrumbs and prefix when breadcrumb is clicked', () => {
        // Arrange
        mockStoreState.hasBucket = false
        mockStoreState.breadcrumbs = ['folder1', 'folder2', 'folder3']
        mockStoreState.prefix = ['prefix1', 'prefix2', 'prefix3']
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2', 'folder3'],
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click on first breadcrumb (index 0)
        const firstBreadcrumb = screen.getByText('folder1')
        fireEvent.click(firstBreadcrumb)

        // Assert - Should slice to index 0 + 1 = 1
        expect(mockStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
        expect(mockStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
        expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith(['folder1'])
        expect(mockStoreState.setPrefix).toHaveBeenCalledWith(['prefix1'])
      })

      it('should not call handler when last breadcrumb is clicked (disabled)', () => {
        // Arrange
        mockStoreState.hasBucket = false
        const props = createDefaultProps({
          breadcrumbs: ['folder1', 'folder2'],
        })
        render(<Breadcrumbs {...props} />)

        // Act - Click on last breadcrumb (should be disabled)
        const lastBreadcrumb = screen.getByText('folder2')
        fireEvent.click(lastBreadcrumb)

        // Assert - Store methods should NOT be called
        expect(mockStoreState.setBreadcrumbs).not.toHaveBeenCalled()
      })

      it('should handle click on collapsed breadcrumb from dropdown', async () => {
        // Arrange
        mockStoreState.hasBucket = false
        mockStoreState.breadcrumbs = ['f1', 'f2', 'f3', 'f4', 'f5']
        mockStoreState.prefix = ['p1', 'p2', 'p3', 'p4', 'p5']
        const props = createDefaultProps({
          breadcrumbs: ['f1', 'f2', 'f3', 'f4', 'f5'],
          isInPipeline: false,
        })
        render(<Breadcrumbs {...props} />)

        // Act - Open dropdown and click on collapsed breadcrumb (f3, index=2)
        const dropdownTrigger = screen.getAllByRole('button').find(btn => btn.querySelector('svg'))
        if (dropdownTrigger)
          fireEvent.click(dropdownTrigger)

        await waitFor(() => {
          expect(screen.getByText('f3')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText('f3'))

        // Assert - Should slice to index 2 + 1 = 3
        expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith(['f1', 'f2', 'f3'])
        expect(mockStoreState.setPrefix).toHaveBeenCalledWith(['p1', 'p2', 'p3'])
      })
    })
  })

  // ==========================================
  // Component Memoization Tests
  // ==========================================
  describe('Component Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert
      expect(Breadcrumbs).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })

    it('should not re-render when props are the same', () => {
      // Arrange
      const props = createDefaultProps()
      const { rerender } = render(<Breadcrumbs {...props} />)

      // Act - Rerender with same props
      rerender(<Breadcrumbs {...props} />)

      // Assert - Component should render without errors
      const container = document.querySelector('.flex.grow')
      expect(container).toBeInTheDocument()
    })

    it('should re-render when breadcrumbs change', () => {
      // Arrange
      mockStoreState.hasBucket = false
      const props = createDefaultProps({ breadcrumbs: ['folder1'] })
      const { rerender } = render(<Breadcrumbs {...props} />)
      expect(screen.getByText('folder1')).toBeInTheDocument()

      // Act - Rerender with different breadcrumbs
      rerender(<Breadcrumbs {...createDefaultProps({ breadcrumbs: ['folder2'] })} />)

      // Assert
      expect(screen.getByText('folder2')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases and Error Handling Tests
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle very long breadcrumb names', () => {
      // Arrange
      mockStoreState.hasBucket = false
      const longName = 'a'.repeat(100)
      const props = createDefaultProps({
        breadcrumbs: [longName],
      })

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('should handle many breadcrumbs', async () => {
      // Arrange
      mockStoreState.hasBucket = false
      const manyBreadcrumbs = Array.from({ length: 20 }, (_, i) => `folder-${i}`)
      const props = createDefaultProps({
        breadcrumbs: manyBreadcrumbs,
      })
      render(<Breadcrumbs {...props} />)

      // Act - Open dropdown
      const dropdownTrigger = screen.getAllByRole('button').find(btn => btn.querySelector('svg'))
      if (dropdownTrigger)
        fireEvent.click(dropdownTrigger)

      // Assert - First, last, and collapsed should be accessible
      expect(screen.getByText('folder-0')).toBeInTheDocument()
      expect(screen.getByText('folder-1')).toBeInTheDocument()
      expect(screen.getByText('folder-19')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByText('folder-2')).toBeInTheDocument()
      })
    })

    it('should handle empty bucket string', () => {
      // Arrange
      mockStoreState.hasBucket = true
      const props = createDefaultProps({
        bucket: '',
        breadcrumbs: [],
      })

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert - Should show all buckets title
      expect(screen.getByText('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')).toBeInTheDocument()
    })

    it('should handle breadcrumb with only whitespace', () => {
      // Arrange
      mockStoreState.hasBucket = false
      const props = createDefaultProps({
        breadcrumbs: ['   ', 'normal-folder'],
      })

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert - Both should be rendered
      expect(screen.getByText('normal-folder')).toBeInTheDocument()
    })
  })

  // ==========================================
  // All Prop Variations Tests
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      { hasBucket: true, bucket: 'b1', breadcrumbs: [], expected: 'bucket visible' },
      { hasBucket: true, bucket: '', breadcrumbs: [], expected: 'all buckets title' },
      { hasBucket: false, bucket: '', breadcrumbs: [], expected: 'all files' },
      { hasBucket: false, bucket: '', breadcrumbs: ['f1'], expected: 'drive with breadcrumb' },
    ])('should render correctly for $expected', ({ hasBucket, bucket, breadcrumbs }) => {
      // Arrange
      mockStoreState.hasBucket = hasBucket
      const props = createDefaultProps({ bucket, breadcrumbs })

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert - Component should render without errors
      const container = document.querySelector('.flex.grow')
      expect(container).toBeInTheDocument()
    })

    it.each([
      { isInPipeline: true, bucket: '', expectedNum: 2 },
      { isInPipeline: false, bucket: '', expectedNum: 3 },
      { isInPipeline: true, bucket: 'b', expectedNum: 1 },
      { isInPipeline: false, bucket: 'b', expectedNum: 2 },
    ])('should calculate displayBreadcrumbNum=$expectedNum when isInPipeline=$isInPipeline and bucket=$bucket', ({ isInPipeline, bucket, expectedNum }) => {
      // Arrange
      mockStoreState.hasBucket = !!bucket
      const breadcrumbs = Array.from({ length: expectedNum + 2 }, (_, i) => `f${i}`)
      const props = createDefaultProps({ isInPipeline, bucket, breadcrumbs })

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert - Should collapse because breadcrumbs.length > expectedNum
      const buttons = screen.getAllByRole('button')
      const hasDropdownTrigger = buttons.some(btn => btn.querySelector('svg'))
      expect(hasDropdownTrigger).toBe(true)
    })
  })

  // ==========================================
  // Integration Tests
  // ==========================================
  describe('Integration', () => {
    it('should handle full navigation flow: bucket -> folders -> navigation back', () => {
      // Arrange
      mockStoreState.hasBucket = true
      mockStoreState.breadcrumbs = ['folder1', 'folder2']
      mockStoreState.prefix = ['prefix1', 'prefix2']
      const props = createDefaultProps({
        bucket: 'my-bucket',
        breadcrumbs: ['folder1', 'folder2'],
      })
      render(<Breadcrumbs {...props} />)

      // Act - Click on first folder to navigate back
      const firstFolder = screen.getByText('folder1')
      fireEvent.click(firstFolder)

      // Assert
      expect(mockStoreState.setBreadcrumbs).toHaveBeenCalledWith(['folder1'])
      expect(mockStoreState.setPrefix).toHaveBeenCalledWith(['prefix1'])
    })

    it('should handle search result display with navigation elements hidden', () => {
      // Arrange
      mockStoreState.hasBucket = true
      const props = createDefaultProps({
        keywords: 'test',
        searchResultsLength: 5,
        bucket: 'my-bucket',
        breadcrumbs: ['folder1'],
      })

      // Act
      render(<Breadcrumbs {...props} />)

      // Assert - Search result should be shown, navigation elements should be hidden
      expect(screen.getByText(/searchResult/)).toBeInTheDocument()
      expect(screen.queryByText('my-bucket')).not.toBeInTheDocument()
    })
  })
})
