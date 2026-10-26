import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import EditAnnotationModal from '../index'

const { mockEditAnnotation } = vi.hoisted(() => ({
  mockEditAnnotation: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: { byAppId: { annotations: { byAnnotationId: { post: mockEditAnnotation } } } },
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '2023-12-01 10:30:00',
  }),
}))

vi.mock('@/app/components/billing/annotation-full', () => ({
  default: () => <div data-testid="annotation-full" />,
}))

const toastSuccessSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')
const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

describe('EditAnnotationModal', () => {
  const defaultProps = {
    isShow: true,
    onHide: vi.fn(),
    appId: 'test-app-id',
    annotationId: 'test-annotation-id',
    query: 'Test query',
    answer: 'Test answer',
    onEdited: vi.fn(),

    onRemove: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockEditAnnotation.mockResolvedValue({})
  })

  afterAll(() => {
    toastSuccessSpy.mockRestore()
    toastErrorSpy.mockRestore()
  })

  describe('Rendering', () => {
    it('should not render modal when isShow is false', () => {
      const props = { ...defaultProps, isShow: false }

      render(<EditAnnotationModal {...props} />)

      expect(screen.queryByText('appAnnotation.editModal.title')).not.toBeInTheDocument()
    })
  })

  describe('API Calls', () => {
    it('should call editAnnotation when updating existing annotation', async () => {
      const mockOnEdited = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        onEdited: mockOnEdited,
      }
      const user = userEvent.setup()

      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0]!)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      expect(mockEditAnnotation).toHaveBeenCalledWith({
        params: { app_id: 'test-app-id', annotation_id: 'test-annotation-id' },
        body: { question: 'Modified query', answer: 'Test answer' },
      })
      await waitFor(() =>
        expect(mockOnEdited).toHaveBeenCalledWith('Modified query', 'Test answer'),
      )
      expect(toastSuccessSpy).toHaveBeenCalledWith('common.api.actionSuccess')
    })
  })

  describe('State Management', () => {
    it('should call onRemove when removal is confirmed', async () => {
      const mockOnRemove = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        onRemove: mockOnRemove,
      }
      const user = userEvent.setup()

      render(<EditAnnotationModal {...props} />)

      await user.click(screen.getByText('appAnnotation.editModal.removeThisCache'))

      const confirmButton = screen.getByRole('button', { name: 'common.operation.confirm' })
      expect(mockOnRemove).not.toHaveBeenCalled()
      await user.click(confirmButton)

      expect(mockOnRemove).toHaveBeenCalled()
    })

    it('should hide confirm modal when removal is cancelled', async () => {
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
      }
      const user = userEvent.setup()

      render(<EditAnnotationModal {...props} />)
      await user.click(screen.getByText('appAnnotation.editModal.removeThisCache'))
      expect(screen.getByText('appDebug.feature.annotation.removeConfirm'))!.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      expect(props.onRemove).not.toHaveBeenCalled()
      expect(props.onHide).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(
          screen.queryByText('appDebug.feature.annotation.removeConfirm'),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('edits only the answer when the question is read-only', async () => {
      const user = userEvent.setup()

      const props = {
        ...defaultProps,
        onlyEditResponse: true,
      }

      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.queryAllByText(/common\.operation\.edit/i)
      expect(editLinks).toHaveLength(1)
      await user.click(editLinks[0]!)
      await user.clear(screen.getByRole('textbox'))
      await user.type(screen.getByRole('textbox'), 'Updated answer')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(mockEditAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ body: { question: 'Test query', answer: 'Updated answer' } }),
      )
    })
  })

  describe('Error Handling', () => {
    it('should show error toast and skip callbacks when editAnnotation fails', async () => {
      const mockOnEdited = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        onEdited: mockOnEdited,
      }
      const user = userEvent.setup()

      mockEditAnnotation.mockRejectedValueOnce(new Error('API Error'))

      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0]!)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith('API Error')
      })
      expect(mockOnEdited).not.toHaveBeenCalled()

      expect(screen.getByRole('textbox'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' }))!.toBeInTheDocument()
    })

    it('should show fallback error message when editAnnotation error is not an Error instance', async () => {
      const mockOnEdited = vi.fn()
      const props = {
        ...defaultProps,
        annotationId: 'test-annotation-id',
        onEdited: mockOnEdited,
      }
      const user = userEvent.setup()

      mockEditAnnotation.mockRejectedValueOnce('oops')

      render(<EditAnnotationModal {...props} />)

      const editLinks = screen.getAllByText(/common\.operation\.edit/i)
      await user.click(editLinks[0]!)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Modified query')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      await waitFor(() => {
        expect(toastErrorSpy).toHaveBeenCalledWith('common.api.actionFailed')
      })
      expect(mockOnEdited).not.toHaveBeenCalled()

      expect(screen.getByRole('textbox'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' }))!.toBeInTheDocument()
    })
  })
})
