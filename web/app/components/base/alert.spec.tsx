import { fireEvent, render, screen } from '@testing-library/react'
import Alert from './alert'

describe('Alert', () => {
  const defaultProps = {
    message: 'This is an alert message',
    onHide: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Alert {...defaultProps} />)
      expect(screen.getByText(defaultProps.message)).toBeInTheDocument()
    })

    it('should render the info icon', () => {
      render(<Alert {...defaultProps} />)
      const icon = screen.getByTestId('info-icon')
      expect(icon).toBeInTheDocument()
    })

    it('should render the close icon', () => {
      render(<Alert {...defaultProps} />)
      const closeIcon = screen.getByTestId('close-icon')
      expect(closeIcon).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<Alert {...defaultProps} className="my-custom-class" />)
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('my-custom-class')
    })

    it('should retain base classes when custom className is applied', () => {
      const { container } = render(<Alert {...defaultProps} className="my-custom-class" />)
      const outerDiv = container.firstChild as HTMLElement
      expect(outerDiv).toHaveClass('pointer-events-none', 'w-full')
    })

    it('should default type to info', () => {
      render(<Alert {...defaultProps} />)
      const gradientDiv = screen.getByTestId('alert-gradient')
      expect(gradientDiv).toHaveClass('from-components-badge-status-light-normal-halo')
    })

    it('should render with explicit type info', () => {
      render(<Alert {...defaultProps} type="info" />)
      const gradientDiv = screen.getByTestId('alert-gradient')
      expect(gradientDiv).toHaveClass('from-components-badge-status-light-normal-halo')
    })

    it('should display the provided message text', () => {
      const msg = 'A different alert message'
      render(<Alert {...defaultProps} message={msg} />)
      expect(screen.getByText(msg)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onHide when close button is clicked', () => {
      const onHide = vi.fn()
      render(<Alert {...defaultProps} onHide={onHide} />)
      const closeButton = screen.getByTestId('close-icon')
      fireEvent.click(closeButton)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should not call onHide when other parts of the alert are clicked', () => {
      const onHide = vi.fn()
      render(<Alert {...defaultProps} onHide={onHide} />)
      fireEvent.click(screen.getByText(defaultProps.message))
      expect(onHide).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should render with an empty message string', () => {
      render(<Alert {...defaultProps} message="" />)
      const messageDiv = screen.getByTestId('msg-container')
      expect(messageDiv).toBeInTheDocument()
      expect(messageDiv).toHaveTextContent('')
    })

    it('should render with a very long message', () => {
      const longMessage = 'A'.repeat(1000)
      render(<Alert {...defaultProps} message={longMessage} />)
      expect(screen.getByText(longMessage)).toBeInTheDocument()
    })
  })
})
