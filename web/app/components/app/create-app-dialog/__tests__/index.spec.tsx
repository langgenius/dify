import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateAppTemplateDialog from '../index'

// Mock external dependencies (not base components)
vi.mock('../app-list', () => ({
  default: function MockAppList({
    onCreateFromBlank,
    onClose,
  }: {
    onCreateFromBlank?: () => void
    onClose: () => void
  }) {
    return (
      <div role="region" aria-label="App list">
        <button type="button" onClick={onClose}>
          Success
        </button>
        {onCreateFromBlank && (
          <button type="button" onClick={onCreateFromBlank}>
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
    onClose: vi.fn(),
    onCreateFromBlank: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render create from blank button when onCreateFromBlank is not provided', () => {
      const { onCreateFromBlank: _onCreateFromBlank, ...propsWithoutOnCreate } = defaultProps

      render(<CreateAppTemplateDialog {...propsWithoutOnCreate} show={true} />)

      expect(screen.queryByRole('button', { name: 'Create from Blank' })).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass show prop to the dialog shell', () => {
      const { rerender } = render(<CreateAppTemplateDialog {...defaultProps} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<CreateAppTemplateDialog {...defaultProps} show={true} />)
      expect(screen.getByRole('dialog'))!.toBeInTheDocument()
    })

    it('should close from the dialog shell close button', async () => {
      const user = userEvent.setup()
      const mockOnClose = vi.fn()

      render(<CreateAppTemplateDialog {...defaultProps} show={true} onClose={mockOnClose} />)

      const closeButton = screen.getByRole('button', { name: 'Close' })
      expect(closeButton)!.toBeInTheDocument()

      await user.click(closeButton)

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('User Interactions', () => {
    it('should close when an app is created from the list', async () => {
      const user = userEvent.setup()
      const mockOnClose = vi.fn()
      render(<CreateAppTemplateDialog {...defaultProps} show={true} onClose={mockOnClose} />)

      await user.click(screen.getByRole('button', { name: 'Success' }))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onCreateFromBlank when create from blank is clicked', async () => {
      const user = userEvent.setup()
      const mockOnCreateFromBlank = vi.fn()
      render(
        <CreateAppTemplateDialog
          {...defaultProps}
          show={true}
          onCreateFromBlank={mockOnCreateFromBlank}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Create from Blank' }))

      expect(mockOnCreateFromBlank).toHaveBeenCalledTimes(1)
    })
  })
})
