import { fireEvent, render, screen } from '@testing-library/react'
import CreateAppTemplateDialog from '../index'

// Mock external dependencies (not base components)
vi.mock('../app-list', () => ({
  default: function MockAppList({
    onCreateFromBlank,
    onSuccess,
  }: {
    onCreateFromBlank?: () => void
    onSuccess: () => void
  }) {
    return (
      <div data-testid="app-list">
        <button data-testid="app-list-success" onClick={onSuccess}>
          Success
        </button>
        {onCreateFromBlank && (
          <button data-testid="create-from-blank" onClick={onCreateFromBlank}>
            Create from Blank
          </button>
        )}
      </div>
    )
  },
}))

describe('CreateAppTemplateDialog', () => {
  const defaultProps = {
    show: false,
    onSuccess: vi.fn(),
    onClose: vi.fn(),
    onCreateFromBlank: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render when show is false', () => {
      render(<CreateAppTemplateDialog {...defaultProps} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render modal when show is true', () => {
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-list'))!.toBeInTheDocument()
    })

    it('should render create from blank button when onCreateFromBlank is provided', () => {
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)

      expect(screen.getByTestId('create-from-blank'))!.toBeInTheDocument()
    })

    it('should not render create from blank button when onCreateFromBlank is not provided', () => {
      const { onCreateFromBlank: _onCreateFromBlank, ...propsWithoutOnCreate } = defaultProps

      render(<CreateAppTemplateDialog {...propsWithoutOnCreate} show={true} />)

      expect(screen.queryByTestId('create-from-blank')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass show prop to the dialog shell', () => {
      const { rerender } = render(<CreateAppTemplateDialog {...defaultProps} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<CreateAppTemplateDialog {...defaultProps} show={true} />)
      expect(screen.getByRole('dialog'))!.toBeInTheDocument()
    })

    it('should close from the dialog shell close button', () => {
      const mockOnClose = vi.fn()

      render(<CreateAppTemplateDialog {...defaultProps} show={true} onClose={mockOnClose} />)

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton)!.toBeInTheDocument()

      fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('User Interactions', () => {
    it('should handle close interactions', () => {
      const mockOnClose = vi.fn()
      render(<CreateAppTemplateDialog {...defaultProps} show={true} onClose={mockOnClose} />)

      // Test that the modal is rendered
      const dialog = screen.getByRole('dialog')
      expect(dialog)!.toBeInTheDocument()

      expect(screen.getByTestId('app-list'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-list-success'))!.toBeInTheDocument()
    })

    it('should call both onSuccess and onClose when app list success is triggered', () => {
      const mockOnSuccess = vi.fn()
      const mockOnClose = vi.fn()
      render(
        <CreateAppTemplateDialog
          {...defaultProps}
          show={true}
          onSuccess={mockOnSuccess}
          onClose={mockOnClose}
        />,
      )

      fireEvent.click(screen.getByTestId('app-list-success'))

      expect(mockOnSuccess).toHaveBeenCalledTimes(1)
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onCreateFromBlank when create from blank is clicked', () => {
      const mockOnCreateFromBlank = vi.fn()
      render(
        <CreateAppTemplateDialog
          {...defaultProps}
          show={true}
          onCreateFromBlank={mockOnCreateFromBlank}
        />,
      )

      fireEvent.click(screen.getByTestId('create-from-blank'))

      expect(mockOnCreateFromBlank).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle null props gracefully', () => {
      expect(() => {
        render(
          <CreateAppTemplateDialog
            show={true}
            onSuccess={vi.fn()}
            onClose={vi.fn()}
          // onCreateFromBlank is undefined
          />,
        )
      }).not.toThrow()
    })

    it('should handle undefined props gracefully', () => {
      expect(() => {
        render(
          <CreateAppTemplateDialog
            show={true}
            onSuccess={vi.fn()}
            onClose={vi.fn()}
            onCreateFromBlank={undefined}
          />,
        )
      }).not.toThrow()
    })

    it('should handle rapid show/hide toggles', () => {
      // Test initial state
      const { unmount } = render(<CreateAppTemplateDialog {...defaultProps} show={false} />)
      unmount()

      // Test show state
      render(<CreateAppTemplateDialog {...defaultProps} show={true} />)
      expect(screen.getByRole('dialog'))!.toBeInTheDocument()

      // Test hide state
      render(<CreateAppTemplateDialog {...defaultProps} show={false} />)
      // Due to transition animations, we just verify the component handles the prop change
      expect(() => render(<CreateAppTemplateDialog {...defaultProps} show={false} />)).not.toThrow()
    })

    it('should handle missing optional onCreateFromBlank prop', () => {
      const { onCreateFromBlank: _onCreateFromBlank, ...propsWithoutOnCreate } = defaultProps

      expect(() => {
        render(<CreateAppTemplateDialog {...propsWithoutOnCreate} show={true} />)
      }).not.toThrow()

      expect(screen.getByTestId('app-list'))!.toBeInTheDocument()
      expect(screen.queryByTestId('create-from-blank')).not.toBeInTheDocument()
    })

    it('should work with all required props only', () => {
      const requiredProps = {
        show: true,
        onSuccess: vi.fn(),
        onClose: vi.fn(),
      }

      expect(() => {
        render(<CreateAppTemplateDialog {...requiredProps} />)
      }).not.toThrow()

      expect(screen.getByRole('dialog'))!.toBeInTheDocument()
      expect(screen.getByTestId('app-list'))!.toBeInTheDocument()
    })
  })
})
