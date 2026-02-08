import { fireEvent, render, screen } from '@testing-library/react'
import PermissionItem from './permission-item'

describe('PermissionItem', () => {
  const defaultProps = {
    leftIcon: <span data-testid="left-icon">Icon</span>,
    text: 'Test Permission',
    onClick: vi.fn(),
    isSelected: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<PermissionItem {...defaultProps} />)
      expect(screen.getByText('Test Permission')).toBeInTheDocument()
    })

    it('should render left icon', () => {
      render(<PermissionItem {...defaultProps} />)
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    })

    it('should render text content', () => {
      const text = 'Custom Permission Text'
      render(<PermissionItem {...defaultProps} text={text} />)
      expect(screen.getByText(text)).toBeInTheDocument()
    })
  })

  describe('Selection State', () => {
    it('should show checkmark icon when selected', () => {
      render(<PermissionItem {...defaultProps} isSelected={true} />)
      // RiCheckLine renders as an svg element
      const container = screen.getByText('Test Permission').closest('div')?.parentElement
      const checkIcon = container?.querySelector('svg')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should not show checkmark icon when not selected', () => {
      render(<PermissionItem {...defaultProps} isSelected={false} />)
      const container = screen.getByText('Test Permission').closest('div')?.parentElement
      const checkIcon = container?.querySelector('svg')
      expect(checkIcon).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<PermissionItem {...defaultProps} onClick={handleClick} />)

      const item = screen.getByText('Test Permission').closest('div')?.parentElement
      fireEvent.click(item!)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should have cursor-pointer class for interactivity', () => {
      render(<PermissionItem {...defaultProps} />)
      const item = screen.getByText('Test Permission').closest('div')?.parentElement
      expect(item).toHaveClass('cursor-pointer')
    })
  })

  describe('Props', () => {
    it('should render different left icons', () => {
      const customIcon = <span data-testid="custom-icon">Custom</span>
      render(<PermissionItem {...defaultProps} leftIcon={customIcon} />)
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })

    it('should handle different text values', () => {
      const texts = ['Only Me', 'All Team Members', 'Invited Members']

      texts.forEach((text) => {
        const { unmount } = render(<PermissionItem {...defaultProps} text={text} />)
        expect(screen.getByText(text)).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle isSelected toggle correctly', () => {
      const { rerender } = render(<PermissionItem {...defaultProps} isSelected={false} />)

      // Initially not selected - no checkmark
      let container = screen.getByText('Test Permission').closest('div')?.parentElement
      expect(container?.querySelector('svg')).not.toBeInTheDocument()

      // Update to selected
      rerender(<PermissionItem {...defaultProps} isSelected={true} />)
      container = screen.getByText('Test Permission').closest('div')?.parentElement
      expect(container?.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      render(<PermissionItem {...defaultProps} text="" />)
      // The component should still render
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    })

    it('should handle long text content', () => {
      const longText = 'A'.repeat(200)
      render(<PermissionItem {...defaultProps} text={longText} />)
      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('should handle special characters in text', () => {
      const specialText = '<script>alert("xss")</script>'
      render(<PermissionItem {...defaultProps} text={specialText} />)
      expect(screen.getByText(specialText)).toBeInTheDocument()
    })

    it('should handle complex left icon nodes', () => {
      const complexIcon = (
        <div data-testid="complex-icon">
          <span>Nested</span>
          <div>Content</div>
        </div>
      )
      render(<PermissionItem {...defaultProps} leftIcon={complexIcon} />)
      expect(screen.getByTestId('complex-icon')).toBeInTheDocument()
    })
  })
})
