import { fireEvent, render, screen } from '@testing-library/react'
import UploadStatusTooltip from './upload-status-tooltip'

type MockWorkflowState = {
  uploadStatus: 'idle' | 'uploading' | 'success' | 'partial_error'
  uploadProgress: {
    uploaded: number
    total: number
    failed: number
  }
}

const mocks = vi.hoisted(() => ({
  storeState: {
    uploadStatus: 'idle',
    uploadProgress: { uploaded: 0, total: 0, failed: 0 },
  } as MockWorkflowState,
  resetUpload: vi.fn(),
  storeApi: {
    getState: () => ({
      resetUpload: mocks.resetUpload,
    }),
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => mocks.storeApi,
}))

const setUploadState = (overrides: Partial<MockWorkflowState> = {}) => {
  mocks.storeState.uploadStatus = overrides.uploadStatus ?? 'idle'
  mocks.storeState.uploadProgress = overrides.uploadProgress ?? { uploaded: 0, total: 0, failed: 0 }
}

describe('UploadStatusTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUploadState()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Different upload states should render different user-facing feedback.
  describe('Rendering', () => {
    it('should render fallback content when upload status is idle', () => {
      // Arrange
      setUploadState({ uploadStatus: 'idle' })

      // Act
      render(<UploadStatusTooltip fallback={<span>Idle fallback</span>} />)

      // Assert
      expect(screen.getByText('Idle fallback')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /common\.operation\.close/i })).not.toBeInTheDocument()
    })

    it('should render uploading text and progress width when upload is in progress', () => {
      // Arrange
      setUploadState({
        uploadStatus: 'uploading',
        uploadProgress: { uploaded: 2, total: 5, failed: 0 },
      })

      // Act
      const { container } = render(<UploadStatusTooltip />)
      const progressBar = container.querySelector('.bg-components-progress-bar-progress')

      // Assert
      expect(screen.getByText(/workflow\.skillSidebar\.uploadingItems/i)).toBeInTheDocument()
      expect(screen.getByText(/"uploaded":2/)).toBeInTheDocument()
      expect(progressBar).toBeInTheDocument()
      expect(progressBar).toHaveStyle({ width: '40%' })
    })

    it('should clamp uploading progress width to 0% when total is 0', () => {
      // Arrange
      setUploadState({
        uploadStatus: 'uploading',
        uploadProgress: { uploaded: 2, total: 0, failed: 0 },
      })

      // Act
      const { container } = render(<UploadStatusTooltip />)
      const progressBar = container.querySelector('.bg-components-progress-bar-progress')

      // Assert
      expect(progressBar).toHaveStyle({ width: '0%' })
    })

    it('should render success title and detail when upload succeeds', () => {
      // Arrange
      setUploadState({
        uploadStatus: 'success',
        uploadProgress: { uploaded: 3, total: 3, failed: 0 },
      })

      // Act
      render(<UploadStatusTooltip />)

      // Assert
      expect(screen.getByText('workflow.skillSidebar.uploadSuccess')).toBeInTheDocument()
      expect(screen.getByText(/workflow\.skillSidebar\.uploadSuccessDetail/i)).toBeInTheDocument()
    })

    it('should render partial error title and detail when upload partially fails', () => {
      // Arrange
      setUploadState({
        uploadStatus: 'partial_error',
        uploadProgress: { uploaded: 2, total: 5, failed: 3 },
      })

      // Act
      render(<UploadStatusTooltip />)

      // Assert
      expect(screen.getByText('workflow.skillSidebar.uploadPartialError')).toBeInTheDocument()
      expect(screen.getByText(/workflow\.skillSidebar\.uploadPartialErrorDetail/i)).toBeInTheDocument()
    })
  })

  // User action should dismiss the tooltip via store action.
  describe('Interactions', () => {
    it('should call resetUpload when close button is clicked', () => {
      // Arrange
      setUploadState({
        uploadStatus: 'partial_error',
        uploadProgress: { uploaded: 2, total: 5, failed: 3 },
      })
      render(<UploadStatusTooltip />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.close/i }))

      // Assert
      expect(mocks.resetUpload).toHaveBeenCalledTimes(1)
    })
  })

  // Success state uses a timer and should clean it up correctly.
  describe('Success timer', () => {
    it('should reset upload automatically after success display duration', () => {
      // Arrange
      vi.useFakeTimers()
      setUploadState({
        uploadStatus: 'success',
        uploadProgress: { uploaded: 1, total: 1, failed: 0 },
      })
      render(<UploadStatusTooltip />)

      // Act
      vi.advanceTimersByTime(1999)

      // Assert
      expect(mocks.resetUpload).not.toHaveBeenCalled()

      // Act
      vi.advanceTimersByTime(1)

      // Assert
      expect(mocks.resetUpload).toHaveBeenCalledTimes(1)
    })

    it('should clear pending success timer when status changes before timeout', () => {
      // Arrange
      vi.useFakeTimers()
      setUploadState({
        uploadStatus: 'success',
        uploadProgress: { uploaded: 1, total: 1, failed: 0 },
      })
      const { rerender } = render(<UploadStatusTooltip fallback={<span>v1</span>} />)

      // Act
      setUploadState({
        uploadStatus: 'uploading',
        uploadProgress: { uploaded: 1, total: 3, failed: 0 },
      })
      rerender(<UploadStatusTooltip fallback={<span>v2</span>} />)
      vi.advanceTimersByTime(3000)

      // Assert
      expect(mocks.resetUpload).not.toHaveBeenCalled()
    })
  })
})
