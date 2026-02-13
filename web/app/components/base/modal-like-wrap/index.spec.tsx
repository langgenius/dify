import { act, fireEvent, render, screen } from '@testing-library/react'
import ModalLikeWrap from '.'

describe('ModalLikeWrap', () => {
  const defaultProps = {
    title: 'Test Title',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    children: <div>Test Content</div>,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Render', () => {
    it('renders title and content correctly', () => {
      render(<ModalLikeWrap {...defaultProps} />)

      expect(screen.getByText('Test Title')).toBeInTheDocument()
      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })

    it('renders beforeHeader if provided', () => {
      const beforeHeader = <div data-testid="before-header">Before Header</div>
      render(<ModalLikeWrap {...defaultProps} beforeHeader={beforeHeader} />)

      expect(screen.getByTestId('before-header')).toBeInTheDocument()
      expect(screen.getByText('Before Header')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('calls onClose when close icon is clicked', async () => {
      render(<ModalLikeWrap {...defaultProps} />)

      const closeBtn = screen.getByTestId('modal-close-btn')
      expect(closeBtn).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(closeBtn)
      })

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when Cancel button is clicked', async () => {
      render(<ModalLikeWrap {...defaultProps} />)

      const cancelBtn = screen.getByText('common.operation.cancel')
      await act(async () => {
        fireEvent.click(cancelBtn)
      })

      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('calls onConfirm when Save button is clicked', async () => {
      render(<ModalLikeWrap {...defaultProps} />)

      const saveBtn = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveBtn)
      })

      expect(defaultProps.onConfirm).toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('hides close icon when hideCloseBtn is true', () => {
      render(<ModalLikeWrap {...defaultProps} hideCloseBtn={true} />)

      const closeBtn = document.querySelector('.remixicon')
      expect(closeBtn).not.toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<ModalLikeWrap {...defaultProps} className="custom-class" />)

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })
})
