import { fireEvent, render, screen } from '@testing-library/react'
import Modal from './modal'

describe('Modal Component', () => {
  const defaultProps = {
    title: 'Test Modal',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Render', () => {
    it('renders correctly with title and children', () => {
      render(
        <Modal {...defaultProps}>
          <div data-testid="modal-child">Child Content</div>
        </Modal>,
      )

      expect(screen.getByText('Test Modal')).toBeInTheDocument()
      expect(screen.getByTestId('modal-child')).toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
      expect(screen.getByText(/save/i)).toBeInTheDocument()
    })

    it('renders subTitle when provided', () => {
      render(<Modal {...defaultProps} subTitle="Test Subtitle" />)
      expect(screen.getByText('Test Subtitle')).toBeInTheDocument()
    })

    it('renders and handles extra button', () => {
      const onExtraClick = vi.fn()
      render(
        <Modal
          {...defaultProps}
          showExtraButton={true}
          extraButtonText="Extra Action"
          onExtraButtonClick={onExtraClick}
        />,
      )

      const extraBtn = screen.getByText('Extra Action')
      expect(extraBtn).toBeInTheDocument()
      fireEvent.click(extraBtn)
      expect(onExtraClick).toHaveBeenCalledTimes(1)
    })

    it('renders footerSlot and bottomSlot', () => {
      render(
        <Modal
          {...defaultProps}
          footerSlot={<div data-testid="footer-slot">Footer</div>}
          bottomSlot={<div data-testid="bottom-slot">Bottom</div>}
        />,
      )

      expect(screen.getByTestId('footer-slot')).toBeInTheDocument()
      expect(screen.getByTestId('bottom-slot')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('calls onClose when close icon is clicked', () => {
      render(<Modal {...defaultProps} />)
      const closeIcon = screen.getByTestId('close-icon').parentElement
      fireEvent.click(closeIcon!)
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onConfirm when confirm button is clicked', () => {
      render(<Modal {...defaultProps} confirmButtonText="Confirm Me" />)
      fireEvent.click(screen.getByText(/confirm/i))
      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when cancel button is clicked', () => {
      render(<Modal {...defaultProps} cancelButtonText="Cancel Me" />)
      fireEvent.click(screen.getByText('Cancel Me'))
      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
    })

    it('handles clickOutsideNotClose logic', () => {
      const onClose = vi.fn()
      const { rerender } = render(<Modal {...defaultProps} onClose={onClose} clickOutsideNotClose={false} />)

      fireEvent.click(screen.getByRole('tooltip'))
      expect(onClose).toHaveBeenCalledTimes(1)

      onClose.mockClear()
      rerender(<Modal {...defaultProps} onClose={onClose} clickOutsideNotClose={true} />)
      fireEvent.click(screen.getByRole('tooltip'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('prevents propagation on internal container click', () => {
      const onClose = vi.fn()
      render(<Modal {...defaultProps} onClose={onClose} clickOutsideNotClose={false} />)
      fireEvent.click(screen.getByText('Test Modal'))
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('Props', () => {
    it('disables buttons when disabled prop is true', () => {
      render(<Modal {...defaultProps} disabled={true} />)
      expect(screen.getByText(/cancel/i).closest('button')).toBeDisabled()
      expect(screen.getByText(/save/i).closest('button')).toBeDisabled()
    })
  })
})
