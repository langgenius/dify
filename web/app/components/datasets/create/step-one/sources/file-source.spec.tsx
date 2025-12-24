import type { FileSourceProps } from '../types'
import type { FileItem } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import FileSource from './file-source'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock child components
vi.mock('../../file-uploader', () => ({
  __esModule: true,
  default: ({ fileList, onPreview, prepareFileList, titleClassName }: {
    fileList: unknown[]
    onPreview: (file: File) => void
    prepareFileList: (files: unknown[]) => void
    titleClassName?: string
  }) => (
    <div data-testid="file-uploader" data-title-classname={titleClassName || ''}>
      <span data-testid="file-count">{fileList.length}</span>
      <button data-testid="trigger-preview" onClick={() => onPreview({ name: 'test.txt' } as File)}>Preview</button>
      <button data-testid="trigger-prepare" onClick={() => prepareFileList([])}>Prepare</button>
    </div>
  ),
}))

vi.mock('../common/next-step-button', () => ({
  __esModule: true,
  default: ({ disabled, onClick }: { disabled: boolean, onClick: () => void }) => (
    <button data-testid="next-step-button" disabled={disabled} onClick={onClick}>
      Next Step
    </button>
  ),
}))

vi.mock('../common/vector-space-alert', () => ({
  __esModule: true,
  default: ({ show }: { show: boolean }) => (
    show ? <div data-testid="vector-space-alert">Vector Space Full</div> : null
  ),
}))

vi.mock('../upgrade-card', () => ({
  __esModule: true,
  default: () => <div data-testid="upgrade-card">Upgrade Card</div>,
}))

// Helper to create mock FileItem
// CustomFile extends File and has optional id field
// Use { noId: true } to create a file without id (simulating uploading state)
const createMockFileItem = (options?: { id?: string, noId?: boolean }): FileItem => {
  const { id = 'file-123', noId = false } = options || {}

  // Create a base file-like object with the required properties
  // We need to cast to unknown first then to the target type since File is a browser API
  const baseFile = {
    name: 'test.txt',
    size: 1024,
    type: 'text/plain',
    lastModified: Date.now(),
    webkitRelativePath: '',
    arrayBuffer: vi.fn(),
    bytes: vi.fn(),
    slice: vi.fn(),
    stream: vi.fn(),
    text: vi.fn(),
    ...(noId ? {} : { id }), // Only add id if not noId
  }

  return {
    fileID: 'test-file-id',
    file: baseFile,
    progress: 100,
  } as unknown as FileItem
}

const createDefaultProps = (): FileSourceProps => ({
  files: [],
  updateFileList: vi.fn(),
  updateFile: vi.fn(),
  onPreview: vi.fn(),
  isShowVectorSpaceFull: false,
  onStepChange: vi.fn(),
  shouldShowDataSourceTypeList: true,
  supportBatchUpload: true,
  enableBilling: false,
  isSandboxPlan: false,
})

describe('FileSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render FileUploader component', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('file-uploader')).toBeInTheDocument()
    })

    it('should render NextStepButton component', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeInTheDocument()
    })

    it('should pass files to FileUploader', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem(), createMockFileItem()],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('file-count')).toHaveTextContent('2')
    })

    it('should pass custom titleClassName when shouldShowDataSourceTypeList is false', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        shouldShowDataSourceTypeList: false,
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      const fileUploader = screen.getByTestId('file-uploader')
      expect(fileUploader).toHaveAttribute('data-title-classname', 'mt-[30px] !mb-[44px] !text-lg')
    })

    it('should pass undefined titleClassName when shouldShowDataSourceTypeList is true', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        shouldShowDataSourceTypeList: true,
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      const fileUploader = screen.getByTestId('file-uploader')
      expect(fileUploader).toHaveAttribute('data-title-classname', '')
    })
  })

  // ==========================================
  // Next Button Disabled State Tests
  // ==========================================
  describe('Next Button Disabled State', () => {
    it('should disable next button when no files', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should disable next button when file has no id (still uploading)', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem({ noId: true })],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should disable next button when vector space is full', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem()],
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should enable next button when files are uploaded and space available', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem()],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should enable next button with multiple uploaded files', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem({ id: 'id1' }), createMockFileItem({ id: 'id2' })],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should disable next button when any file is still uploading', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem({ id: 'id1' }), createMockFileItem({ noId: true })],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })
  })

  // ==========================================
  // Vector Space Alert Tests
  // ==========================================
  describe('Vector Space Alert', () => {
    it('should not show vector space alert by default', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.queryByTestId('vector-space-alert')).not.toBeInTheDocument()
    })

    it('should show vector space alert when isShowVectorSpaceFull is true', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('vector-space-alert')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Upgrade Card Tests
  // ==========================================
  describe('Upgrade Card', () => {
    it('should not show upgrade card by default', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.queryByTestId('upgrade-card')).not.toBeInTheDocument()
    })

    it('should not show upgrade card when enableBilling is false', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        enableBilling: false,
        isSandboxPlan: true,
        files: [createMockFileItem()],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.queryByTestId('upgrade-card')).not.toBeInTheDocument()
    })

    it('should not show upgrade card when not sandbox plan', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        enableBilling: true,
        isSandboxPlan: false,
        files: [createMockFileItem()],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.queryByTestId('upgrade-card')).not.toBeInTheDocument()
    })

    it('should not show upgrade card when no files', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        enableBilling: true,
        isSandboxPlan: true,
        files: [],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.queryByTestId('upgrade-card')).not.toBeInTheDocument()
    })

    it('should show upgrade card when all conditions are met', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        enableBilling: true,
        isSandboxPlan: true,
        files: [createMockFileItem()],
      }

      // Act
      render(<FileSource {...props} />)

      // Assert
      expect(screen.getByTestId('upgrade-card')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Callback Tests
  // ==========================================
  describe('Callbacks', () => {
    it('should call onStepChange when next button is clicked', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem()],
      }
      render(<FileSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('next-step-button'))

      // Assert
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should call onPreview when file preview is triggered', () => {
      // Arrange
      const props = createDefaultProps()
      render(<FileSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-preview'))

      // Assert
      expect(props.onPreview).toHaveBeenCalledWith({ name: 'test.txt' })
    })

    it('should call updateFileList when prepareFileList is triggered', () => {
      // Arrange
      const props = createDefaultProps()
      render(<FileSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-prepare'))

      // Assert
      expect(props.updateFileList).toHaveBeenCalledWith([])
    })
  })

  // ==========================================
  // Memoization Tests
  // ==========================================
  describe('Memoization', () => {
    it('should update nextDisabled when files change', () => {
      // Arrange
      const props = createDefaultProps()
      const { rerender } = render(<FileSource {...props} />)

      // Assert initial state
      expect(screen.getByTestId('next-step-button')).toBeDisabled()

      // Act - update with uploaded files
      rerender(<FileSource {...props} files={[createMockFileItem()]} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should update nextDisabled when isShowVectorSpaceFull changes', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        files: [createMockFileItem()],
      }
      const { rerender } = render(<FileSource {...props} />)

      // Assert initial state
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()

      // Act - set vector space full
      rerender(<FileSource {...props} isShowVectorSpaceFull={true} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })
  })
})
