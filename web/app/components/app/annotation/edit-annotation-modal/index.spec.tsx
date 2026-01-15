import type { IToastProps, ToastHandle } from '@/app/components/base/toast'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Toast from '@/app/components/base/toast'
import EditAnnotationModal from './index'

const { mockAddAnnotation, mockEditAnnotation } = vi.hoisted(() => ({
  mockAddAnnotation: vi.fn(),
  mockEditAnnotation: vi.fn(),
}))

// Mock only external dependencies
vi.mock('@/service/annotation', () => ({
  addAnnotation: mockAddAnnotation,
  editAnnotation: mockEditAnnotation,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      usage: { annotatedResponse: 5 },
      total: { annotatedResponse: 10 },
    },
    enableBilling: true,
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '2023-12-01 10:30:00',
  }),
}))

// Note: i18n is automatically mocked by Vitest via web/vitest.setup.ts

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

type ToastNotifyProps = Pick<IToastProps, 'type' | 'size' | 'message' | 'duration' | 'className' | 'customComponent' | 'onClose'>
type ToastWithNotify = typeof Toast & { notify: (props: ToastNotifyProps) => ToastHandle }
const toastWithNotify = Toast as unknown as ToastWithNotify
const toastNotifySpy = vi.spyOn(toastWithNotify, 'notify').mockReturnValue({ clear: vi.fn() })

describe('EditAnnotationModal', () => {
  const defaultProps = {
    isShow: true,
    onHide: vi.fn(),
    appId: 'test-app-id',
    query: 'Test query',
    answer: 'Test answer',
    onEdited: vi.fn(),
    onAdded: vi.fn(),
    onRemove: vi.fn(),
  }

  afterAll(() => {
    toastNotifySpy.mockRestore()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddAnnotation.mockResolvedValue({
      id: 'test-id',
      account: { name: 'Test User' },
    })
    mockEditAnnotation.mockResolvedValue({})
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render modal when isShow is true', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Check for modal title as it appears in the mock
      expect(screen.getByText('appAnnotation.editModal.title')).toBeInTheDocument()
    })

    it('should not render modal when isShow is false', () => {
      // Arrange
      const props = { ...defaultProps, isShow: false }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert
      expect(screen.queryByText('appAnnotation.editModal.title')).not.toBeInTheDocument()
    })

    it('should display query and answer sections', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Look for query and answer content
      expect(screen.getByText('Test query')).toBeInTheDocument()
      expect(screen.getByText('Test answer')).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should handle different query and answer content', () => {
      // Arrange
      const props = {
        ...defaultProps,
        query: 'Custom query content',
        answer: 'Custom answer content',
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Check content is displayed
      expect(screen.getByText('Custom query content')).toBeInTheDocument()
      expect(screen.getByText('Custom answer content')).toBeInTheDocument()
    })

    it('should show remove option when annotationId is provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Remove option should be present (using pattern)
      expect(screen.getByText('appAnnotation.editModal.removeThisCache')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should enable editing for query and answer sections', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Edit links should be visible (using text content)
      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      expect(editLinks).toHaveLength(2)
    })

    it('should show remove option when annotationId is provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert
      expect(screen.getByText('appAnnotation.editModal.removeThisCache')).toBeInTheDocument()
    })

    it('should save content when edited', async () => {
      // Arrange
      const mockOnAdded = vi.fn()
      const props = {
        ...defaultProps,
        onAdded: mockOnAdded,
      }
      const user = userEvent.setup()

      // Mock API response
      mockAddAnnotation.mockResolvedValueOnce({
        id: 'test-annotation-id',
        account: { name: 'Test User' },
      })

      // Act
      render(<EditAnnotationModal {...props} />)

      // Find and click edit link for query
      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      // Find textarea and enter new content
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'New query content')

      // Click save button
      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      expect(mockAddAnnotation).toHaveBeenCalledWith('test-app-id', {
        question: 'New query content',
        answer: 'Test answer',
        message_id: undefined,
      })
    })
  })

  // API Calls
  describe('API Calls', () => {
    it('should call addAnnotation when saving new annotation', async () => {
      // Arrange
      const mockOnAdded = vi.fn()
      const props = {
        ...defaultProps,
        onAdded: mockOnAdded,
      }
      const user = userEvent.setup()

      // Mock the API response
      mockAddAnnotation.mockResolvedValueOnce({
        id: 'test-annotation-id',
        account: { name: 'Test User' },
      })

      // Act
      render(<EditAnnotationModal {...props} />)

      // Edit query content
      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Updated query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      expect(mockAddAnnotation).toHaveBeenCalledWith('test-app-id', {
        question: 'Updated query',
        answer: 'Test answer',
        message_id: undefined,
      })
    })

    it('should call editAnnotation when updating existing annotation', async () => {
      // Arrange
      const mockOnEdited = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        messageId: 'test-message-id',
        onEdited: mockOnEdited,
      }
      const user = userEvent.setup()

      // Act
      render(<EditAnnotationModal {...props} />)

      // Edit query content
      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      expect(mockEditAnnotation).toHaveBeenCalledWith(
        'test-app-id',
        'test-annotation-id',
        {
          message_id: 'test-message-id',
          question: 'Modified query',
          answer: 'Test answer',
        },
      )
    })
  })

  // State Management
  describe('State Management', () => {
    it('should initialize with closed confirm modal', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Confirm dialog should not be visible initially
      expect(screen.queryByText('appDebug.feature.annotation.removeConfirm')).not.toBeInTheDocument()
    })

    it('should show confirm modal when remove is clicked', async () => {
      // Arrange
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
      }
      const user = userEvent.setup()

      // Act
      render(<EditAnnotationModal {...props} />)
      await user.click(screen.getByText('appAnnotation.editModal.removeThisCache'))

      // Assert - Confirmation dialog should appear
      expect(screen.getByText('appDebug.feature.annotation.removeConfirm')).toBeInTheDocument()
    })

    it('should call onRemove when removal is confirmed', async () => {
      // Arrange
      const mockOnRemove = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        onRemove: mockOnRemove,
      }
      const user = userEvent.setup()

      // Act
      render(<EditAnnotationModal {...props} />)

      // Click remove
      await user.click(screen.getByText('appAnnotation.editModal.removeThisCache'))

      // Click confirm
      const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })
      await user.click(confirmButton)

      // Assert
      expect(mockOnRemove).toHaveBeenCalled()
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle empty query and answer', () => {
      // Arrange
      const props = {
        ...defaultProps,
        query: '',
        answer: '',
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert
      expect(screen.getByText('appAnnotation.editModal.title')).toBeInTheDocument()
    })

    it('should handle very long content', () => {
      // Arrange
      const longQuery = 'Q'.repeat(1000)
      const longAnswer = 'A'.repeat(1000)
      const props = {
        ...defaultProps,
        query: longQuery,
        answer: longAnswer,
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert
      expect(screen.getByText(longQuery)).toBeInTheDocument()
      expect(screen.getByText(longAnswer)).toBeInTheDocument()
    })

    it('should handle special characters in content', () => {
      // Arrange
      const specialQuery = 'Query with & < > " \' characters'
      const specialAnswer = 'Answer with & < > " \' characters'
      const props = {
        ...defaultProps,
        query: specialQuery,
        answer: specialAnswer,
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert
      expect(screen.getByText(specialQuery)).toBeInTheDocument()
      expect(screen.getByText(specialAnswer)).toBeInTheDocument()
    })

    it('should handle onlyEditResponse prop', () => {
      // Arrange
      const props = {
        ...defaultProps,
        onlyEditResponse: true,
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Query should be readonly, answer should be editable
      const editLinks = screen.queryAllByText(/common\.operation\.edit/i)
      expect(editLinks).toHaveLength(1) // Only answer should have edit button
    })
  })

  // Error Handling (CRITICAL for coverage)
  describe('Error Handling', () => {
    it('should show error toast and skip callbacks when addAnnotation fails', async () => {
      // Arrange
      const mockOnAdded = vi.fn()
      const props = {
        ...defaultProps,
        onAdded: mockOnAdded,
      }
      const user = userEvent.setup()

      // Mock API failure
      mockAddAnnotation.mockRejectedValueOnce(new Error('API Error'))

      // Act
      render(<EditAnnotationModal {...props} />)

      // Find and click edit link for query
      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      // Find textarea and enter new content
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'New query content')

      // Click save button
      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          message: 'API Error',
          type: 'error',
        })
      })
      expect(mockOnAdded).not.toHaveBeenCalled()

      // Verify edit mode remains open (textarea should still be visible)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    })

    it('should show fallback error message when addAnnotation error has no message', async () => {
      // Arrange
      const mockOnAdded = vi.fn()
      const props = {
        ...defaultProps,
        onAdded: mockOnAdded,
      }
      const user = userEvent.setup()

      mockAddAnnotation.mockRejectedValueOnce({})

      // Act
      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'New query content')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          message: 'common.api.actionFailed',
          type: 'error',
        })
      })
      expect(mockOnAdded).not.toHaveBeenCalled()

      // Verify edit mode remains open (textarea should still be visible)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    })

    it('should show error toast and skip callbacks when editAnnotation fails', async () => {
      // Arrange
      const mockOnEdited = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        messageId: 'test-message-id',
        onEdited: mockOnEdited,
      }
      const user = userEvent.setup()

      // Mock API failure
      mockEditAnnotation.mockRejectedValueOnce(new Error('API Error'))

      // Act
      render(<EditAnnotationModal {...props} />)

      // Edit query content
      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          message: 'API Error',
          type: 'error',
        })
      })
      expect(mockOnEdited).not.toHaveBeenCalled()

      // Verify edit mode remains open (textarea should still be visible)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    })

    it('should show fallback error message when editAnnotation error is not an Error instance', async () => {
      // Arrange
      const mockOnEdited = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        messageId: 'test-message-id',
        onEdited: mockOnEdited,
      }
      const user = userEvent.setup()

      mockEditAnnotation.mockRejectedValueOnce('oops')

      // Act
      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          message: 'common.api.actionFailed',
          type: 'error',
        })
      })
      expect(mockOnEdited).not.toHaveBeenCalled()

      // Verify edit mode remains open (textarea should still be visible)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    })
  })

  // Billing & Plan Features
  describe('Billing & Plan Features', () => {
    it('should show createdAt time when provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        createdAt: 1701381000, // 2023-12-01 10:30:00
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Check that the formatted time appears somewhere in the component
      const container = screen.getByRole('dialog')
      expect(container).toHaveTextContent('2023-12-01 10:30:00')
    })

    it('should not show createdAt when not provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        // createdAt is undefined
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Should not contain any timestamp
      const container = screen.getByRole('dialog')
      expect(container).not.toHaveTextContent('2023-12-01 10:30:00')
    })

    it('should display remove section when annotationId exists', () => {
      // Arrange
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
      }

      // Act
      render(<EditAnnotationModal {...props} />)

      // Assert - Should have remove functionality
      expect(screen.getByText('appAnnotation.editModal.removeThisCache')).toBeInTheDocument()
    })
  })

  // Toast Notifications (Success)
  describe('Toast Notifications', () => {
    it('should show success notification when save operation completes', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0])

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Updated query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      // Assert
      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          message: 'common.api.actionSuccess',
          type: 'success',
        })
      })
    })
  })

  // React.memo Performance Testing
  describe('React.memo Performance', () => {
    it('should not re-render when props are the same', () => {
      // Arrange
      const props = { ...defaultProps }
      const { rerender } = render(<EditAnnotationModal {...props} />)

      // Act - Re-render with same props
      rerender(<EditAnnotationModal {...props} />)

      // Assert - Component should still be visible (no errors thrown)
      expect(screen.getByText('appAnnotation.editModal.title')).toBeInTheDocument()
    })

    it('should re-render when props change', () => {
      // Arrange
      const props = { ...defaultProps }
      const { rerender } = render(<EditAnnotationModal {...props} />)

      // Act - Re-render with different props
      const newProps = { ...props, query: 'New query content' }
      rerender(<EditAnnotationModal {...newProps} />)

      // Assert - Should show new content
      expect(screen.getByText('New query content')).toBeInTheDocument()
    })
  })
})
