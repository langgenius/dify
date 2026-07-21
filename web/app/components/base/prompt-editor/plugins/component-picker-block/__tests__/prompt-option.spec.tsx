import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { PromptMenuItem } from '../prompt-option'

describe('PromptMenuItem', () => {
  const defaultProps = {
    icon: <span data-testid="test-icon">icon</span>,
    title: 'Test Option',
    isSelected: false,
    onClick: vi.fn(),
    onMouseEnter: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the icon and title correctly', () => {
      render(<PromptMenuItem {...defaultProps} />)

      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
      expect(screen.getByText('Test Option')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    describe('onClick', () => {
      it('should call onClick when not disabled', () => {
        render(<PromptMenuItem {...defaultProps} />)

        fireEvent.click(screen.getByText('Test Option'))

        expect(defaultProps.onClick).toHaveBeenCalledTimes(1)
      })

      it('should NOT call onClick when disabled', () => {
        render(<PromptMenuItem {...defaultProps} disabled={true} />)

        fireEvent.click(screen.getByText('Test Option'))

        expect(defaultProps.onClick).not.toHaveBeenCalled()
      })
    })

    describe('onMouseEnter', () => {
      it('should call onMouseEnter when not disabled', () => {
        render(<PromptMenuItem {...defaultProps} />)

        fireEvent.mouseEnter(screen.getByText('Test Option'))

        expect(defaultProps.onMouseEnter).toHaveBeenCalledTimes(1)
      })

      it('should NOT call onMouseEnter when disabled', () => {
        render(<PromptMenuItem {...defaultProps} disabled={true} />)

        fireEvent.mouseEnter(screen.getByText('Test Option'))

        expect(defaultProps.onMouseEnter).not.toHaveBeenCalled()
      })
    })

    describe('onMouseDown', () => {
      it('should prevent default and stop propagation', () => {
        render(<PromptMenuItem {...defaultProps} />)

        const element = screen.getByText('Test Option').parentElement!

        // Use createEvent to properly spy on preventDefault and stopPropagation
        const mouseDownEvent = createEvent.mouseDown(element)
        const preventDefault = vi.fn()
        const stopPropagation = vi.fn()

        mouseDownEvent.preventDefault = preventDefault
        mouseDownEvent.stopPropagation = stopPropagation

        fireEvent(element, mouseDownEvent)

        expect(preventDefault).toHaveBeenCalled()
        expect(stopPropagation).toHaveBeenCalled()
      })
    })
  })

  describe('Reference Management', () => {
    it('should call setRefElement with the div element if provided', () => {
      const setRefElement = vi.fn()
      const { container } = render(
        <PromptMenuItem {...defaultProps} setRefElement={setRefElement} />,
      )

      const menuDiv = container.firstChild
      expect(setRefElement).toHaveBeenCalledWith(menuDiv)
    })
  })
})
