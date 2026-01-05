import type { IDrawerProps } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Drawer from './index'

// Capture dialog onClose for testing
let capturedDialogOnClose: (() => void) | null = null

// Mock @headlessui/react
vi.mock('@headlessui/react', () => ({
  Dialog: ({ children, open, onClose, className, unmount }: {
    children: React.ReactNode
    open: boolean
    onClose: () => void
    className: string
    unmount: boolean
  }) => {
    capturedDialogOnClose = onClose
    if (!open)
      return null
    return (
      <div
        data-testid="dialog"
        data-open={open}
        data-unmount={unmount}
        className={className}
        role="dialog"
      >
        {children}
      </div>
    )
  },
  DialogBackdrop: ({ children, className, onClick }: {
    children?: React.ReactNode
    className: string
    onClick: () => void
  }) => (
    <div
      data-testid="dialog-backdrop"
      className={className}
      onClick={onClick}
    >
      {children}
    </div>
  ),
  DialogTitle: ({ children, as: _as, className, ...props }: {
    children: React.ReactNode
    as?: string
    className?: string
  }) => (
    <div data-testid="dialog-title" className={className} {...props}>
      {children}
    </div>
  ),
}))

// Mock XMarkIcon
vi.mock('@heroicons/react/24/outline', () => ({
  XMarkIcon: ({ className, onClick }: { className: string, onClick?: () => void }) => (
    <svg data-testid="close-icon" className={className} onClick={onClick} />
  ),
}))

// Helper function to render Drawer with default props
const defaultProps: IDrawerProps = {
  isOpen: true,
  onClose: vi.fn(),
  children: <div data-testid="drawer-content">Content</div>,
}

const renderDrawer = (props: Partial<IDrawerProps> = {}) => {
  const mergedProps = { ...defaultProps, ...props }
  return render(<Drawer {...mergedProps} />)
}

describe('Drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedDialogOnClose = null
  })

  // Basic rendering tests
  describe('Rendering', () => {
    it('should render when isOpen is true', () => {
      // Arrange & Act
      renderDrawer({ isOpen: true })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('drawer-content')).toBeInTheDocument()
    })

    it('should not render when isOpen is false', () => {
      // Arrange & Act
      renderDrawer({ isOpen: false })

      // Assert
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render children content', () => {
      // Arrange
      const childContent = <p data-testid="custom-child">Custom Content</p>

      // Act
      renderDrawer({ children: childContent })

      // Assert
      expect(screen.getByTestId('custom-child')).toBeInTheDocument()
      expect(screen.getByText('Custom Content')).toBeInTheDocument()
    })
  })

  // Title and description tests
  describe('Title and Description', () => {
    it('should render title when provided', () => {
      // Arrange & Act
      renderDrawer({ title: 'Test Title' })

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('should not render title when not provided', () => {
      // Arrange & Act
      renderDrawer({ title: '' })

      // Assert
      const titles = screen.queryAllByTestId('dialog-title')
      const titleWithText = titles.find(el => el.textContent !== '')
      expect(titleWithText).toBeUndefined()
    })

    it('should render description when provided', () => {
      // Arrange & Act
      renderDrawer({ description: 'Test Description' })

      // Assert
      expect(screen.getByText('Test Description')).toBeInTheDocument()
    })

    it('should not render description when not provided', () => {
      // Arrange & Act
      renderDrawer({ description: '' })

      // Assert
      expect(screen.queryByText('Test Description')).not.toBeInTheDocument()
    })

    it('should render both title and description together', () => {
      // Arrange & Act
      renderDrawer({
        title: 'My Title',
        description: 'My Description',
      })

      // Assert
      expect(screen.getByText('My Title')).toBeInTheDocument()
      expect(screen.getByText('My Description')).toBeInTheDocument()
    })
  })

  // Close button tests
  describe('Close Button', () => {
    it('should render close icon when showClose is true', () => {
      // Arrange & Act
      renderDrawer({ showClose: true })

      // Assert
      expect(screen.getByTestId('close-icon')).toBeInTheDocument()
    })

    it('should not render close icon when showClose is false', () => {
      // Arrange & Act
      renderDrawer({ showClose: false })

      // Assert
      expect(screen.queryByTestId('close-icon')).not.toBeInTheDocument()
    })

    it('should not render close icon by default', () => {
      // Arrange & Act
      renderDrawer({})

      // Assert
      expect(screen.queryByTestId('close-icon')).not.toBeInTheDocument()
    })

    it('should call onClose when close icon is clicked', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ showClose: true, onClose })

      // Act
      fireEvent.click(screen.getByTestId('close-icon'))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Backdrop/Mask tests
  describe('Backdrop and Mask', () => {
    it('should render backdrop when noOverlay is false', () => {
      // Arrange & Act
      renderDrawer({ noOverlay: false })

      // Assert
      expect(screen.getByTestId('dialog-backdrop')).toBeInTheDocument()
    })

    it('should not render backdrop when noOverlay is true', () => {
      // Arrange & Act
      renderDrawer({ noOverlay: true })

      // Assert
      expect(screen.queryByTestId('dialog-backdrop')).not.toBeInTheDocument()
    })

    it('should apply mask background when mask is true', () => {
      // Arrange & Act
      renderDrawer({ mask: true })

      // Assert
      const backdrop = screen.getByTestId('dialog-backdrop')
      expect(backdrop.className).toContain('bg-black/30')
    })

    it('should not apply mask background when mask is false', () => {
      // Arrange & Act
      renderDrawer({ mask: false })

      // Assert
      const backdrop = screen.getByTestId('dialog-backdrop')
      expect(backdrop.className).not.toContain('bg-black/30')
    })

    it('should call onClose when backdrop is clicked and clickOutsideNotOpen is false', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ onClose, clickOutsideNotOpen: false })

      // Act
      fireEvent.click(screen.getByTestId('dialog-backdrop'))

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when backdrop is clicked and clickOutsideNotOpen is true', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ onClose, clickOutsideNotOpen: true })

      // Act
      fireEvent.click(screen.getByTestId('dialog-backdrop'))

      // Assert
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  // Footer tests
  describe('Footer', () => {
    it('should render default footer with cancel and save buttons when footer is undefined', () => {
      // Arrange & Act
      renderDrawer({ footer: undefined })

      // Assert
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
    })

    it('should not render footer when footer is null', () => {
      // Arrange & Act
      renderDrawer({ footer: null })

      // Assert
      expect(screen.queryByText('common.operation.cancel')).not.toBeInTheDocument()
      expect(screen.queryByText('common.operation.save')).not.toBeInTheDocument()
    })

    it('should render custom footer when provided', () => {
      // Arrange
      const customFooter = <div data-testid="custom-footer">Custom Footer</div>

      // Act
      renderDrawer({ footer: customFooter })

      // Assert
      expect(screen.getByTestId('custom-footer')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.cancel')).not.toBeInTheDocument()
    })

    it('should call onCancel when cancel button is clicked', () => {
      // Arrange
      const onCancel = vi.fn()
      renderDrawer({ onCancel })

      // Act
      const cancelButton = screen.getByText('common.operation.cancel')
      fireEvent.click(cancelButton)

      // Assert
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onOk when save button is clicked', () => {
      // Arrange
      const onOk = vi.fn()
      renderDrawer({ onOk })

      // Act
      const saveButton = screen.getByText('common.operation.save')
      fireEvent.click(saveButton)

      // Assert
      expect(onOk).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onCancel is not provided and cancel is clicked', () => {
      // Arrange
      renderDrawer({ onCancel: undefined })

      // Act & Assert
      expect(() => {
        fireEvent.click(screen.getByText('common.operation.cancel'))
      }).not.toThrow()
    })

    it('should not throw when onOk is not provided and save is clicked', () => {
      // Arrange
      renderDrawer({ onOk: undefined })

      // Act & Assert
      expect(() => {
        fireEvent.click(screen.getByText('common.operation.save'))
      }).not.toThrow()
    })
  })

  // Custom className tests
  describe('Custom ClassNames', () => {
    it('should apply custom dialogClassName', () => {
      // Arrange & Act
      renderDrawer({ dialogClassName: 'custom-dialog-class' })

      // Assert
      expect(screen.getByRole('dialog').className).toContain('custom-dialog-class')
    })

    it('should apply custom dialogBackdropClassName', () => {
      // Arrange & Act
      renderDrawer({ dialogBackdropClassName: 'custom-backdrop-class' })

      // Assert
      expect(screen.getByTestId('dialog-backdrop').className).toContain('custom-backdrop-class')
    })

    it('should apply custom containerClassName', () => {
      // Arrange & Act
      const { container } = renderDrawer({ containerClassName: 'custom-container-class' })

      // Assert
      const containerDiv = container.querySelector('.custom-container-class')
      expect(containerDiv).toBeInTheDocument()
    })

    it('should apply custom panelClassName', () => {
      // Arrange & Act
      const { container } = renderDrawer({ panelClassName: 'custom-panel-class' })

      // Assert
      const panelDiv = container.querySelector('.custom-panel-class')
      expect(panelDiv).toBeInTheDocument()
    })
  })

  // Position tests
  describe('Position', () => {
    it('should apply center position class when positionCenter is true', () => {
      // Arrange & Act
      const { container } = renderDrawer({ positionCenter: true })

      // Assert
      const containerDiv = container.querySelector('.\\!justify-center')
      expect(containerDiv).toBeInTheDocument()
    })

    it('should use end position by default when positionCenter is false', () => {
      // Arrange & Act
      const { container } = renderDrawer({ positionCenter: false })

      // Assert
      const containerDiv = container.querySelector('.justify-end')
      expect(containerDiv).toBeInTheDocument()
    })
  })

  // Unmount prop tests
  describe('Unmount Prop', () => {
    it('should pass unmount prop to Dialog component', () => {
      // Arrange & Act
      renderDrawer({ unmount: true })

      // Assert
      expect(screen.getByTestId('dialog').getAttribute('data-unmount')).toBe('true')
    })

    it('should default unmount to false', () => {
      // Arrange & Act
      renderDrawer({})

      // Assert
      expect(screen.getByTestId('dialog').getAttribute('data-unmount')).toBe('false')
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty string title', () => {
      // Arrange & Act
      renderDrawer({ title: '' })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle empty string description', () => {
      // Arrange & Act
      renderDrawer({ description: '' })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle special characters in title', () => {
      // Arrange
      const specialTitle = '<script>alert("xss")</script>'

      // Act
      renderDrawer({ title: specialTitle })

      // Assert
      expect(screen.getByText(specialTitle)).toBeInTheDocument()
    })

    it('should handle very long title', () => {
      // Arrange
      const longTitle = 'A'.repeat(500)

      // Act
      renderDrawer({ title: longTitle })

      // Assert
      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle complex children with multiple elements', () => {
      // Arrange
      const complexChildren = (
        <div data-testid="complex-children">
          <h1>Heading</h1>
          <p>Paragraph</p>
          <input data-testid="input-element" />
          <button data-testid="button-element">Button</button>
        </div>
      )

      // Act
      renderDrawer({ children: complexChildren })

      // Assert
      expect(screen.getByTestId('complex-children')).toBeInTheDocument()
      expect(screen.getByText('Heading')).toBeInTheDocument()
      expect(screen.getByText('Paragraph')).toBeInTheDocument()
      expect(screen.getByTestId('input-element')).toBeInTheDocument()
      expect(screen.getByTestId('button-element')).toBeInTheDocument()
    })

    it('should handle null children gracefully', () => {
      // Arrange & Act
      renderDrawer({ children: null as unknown as React.ReactNode })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle undefined footer without crashing', () => {
      // Arrange & Act
      renderDrawer({ footer: undefined })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle rapid open/close toggles', () => {
      // Arrange
      const onClose = vi.fn()
      const { rerender } = render(
        <Drawer {...defaultProps} isOpen={true} onClose={onClose}>
          <div>Content</div>
        </Drawer>,
      )

      // Act - Toggle multiple times
      rerender(
        <Drawer {...defaultProps} isOpen={false} onClose={onClose}>
          <div>Content</div>
        </Drawer>,
      )
      rerender(
        <Drawer {...defaultProps} isOpen={true} onClose={onClose}>
          <div>Content</div>
        </Drawer>,
      )
      rerender(
        <Drawer {...defaultProps} isOpen={false} onClose={onClose}>
          <div>Content</div>
        </Drawer>,
      )

      // Assert
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  // Combined prop scenarios
  describe('Combined Prop Scenarios', () => {
    it('should render with all optional props', () => {
      // Arrange & Act
      renderDrawer({
        title: 'Full Feature Title',
        description: 'Full Feature Description',
        dialogClassName: 'custom-dialog',
        dialogBackdropClassName: 'custom-backdrop',
        containerClassName: 'custom-container',
        panelClassName: 'custom-panel',
        showClose: true,
        mask: true,
        positionCenter: true,
        unmount: true,
        noOverlay: false,
        footer: <div data-testid="custom-full-footer">Footer</div>,
      })

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Full Feature Title')).toBeInTheDocument()
      expect(screen.getByText('Full Feature Description')).toBeInTheDocument()
      expect(screen.getByTestId('close-icon')).toBeInTheDocument()
      expect(screen.getByTestId('custom-full-footer')).toBeInTheDocument()
    })

    it('should render minimal drawer with only required props', () => {
      // Arrange
      const minimalProps: IDrawerProps = {
        isOpen: true,
        onClose: vi.fn(),
        children: <div>Minimal Content</div>,
      }

      // Act
      render(<Drawer {...minimalProps} />)

      // Assert
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Minimal Content')).toBeInTheDocument()
    })

    it('should handle showClose with title simultaneously', () => {
      // Arrange & Act
      renderDrawer({
        title: 'Title with Close',
        showClose: true,
      })

      // Assert
      expect(screen.getByText('Title with Close')).toBeInTheDocument()
      expect(screen.getByTestId('close-icon')).toBeInTheDocument()
    })

    it('should handle noOverlay with clickOutsideNotOpen', () => {
      // Arrange
      const onClose = vi.fn()

      // Act
      renderDrawer({
        noOverlay: true,
        clickOutsideNotOpen: true,
        onClose,
      })

      // Assert - backdrop should not exist
      expect(screen.queryByTestId('dialog-backdrop')).not.toBeInTheDocument()
    })
  })

  // Dialog onClose callback tests (e.g., Escape key)
  describe('Dialog onClose Callback', () => {
    it('should call onClose when Dialog triggers close and clickOutsideNotOpen is false', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ onClose, clickOutsideNotOpen: false })

      // Act - Simulate Dialog's onClose (e.g., pressing Escape)
      capturedDialogOnClose?.()

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when Dialog triggers close and clickOutsideNotOpen is true', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ onClose, clickOutsideNotOpen: true })

      // Act - Simulate Dialog's onClose (e.g., pressing Escape)
      capturedDialogOnClose?.()

      // Assert
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should call onClose by default when Dialog triggers close', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ onClose })

      // Act
      capturedDialogOnClose?.()

      // Assert
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // Event handler interaction tests
  describe('Event Handler Interactions', () => {
    it('should handle multiple consecutive close icon clicks', () => {
      // Arrange
      const onClose = vi.fn()
      renderDrawer({ showClose: true, onClose })

      // Act
      const closeIcon = screen.getByTestId('close-icon')
      fireEvent.click(closeIcon)
      fireEvent.click(closeIcon)
      fireEvent.click(closeIcon)

      // Assert
      expect(onClose).toHaveBeenCalledTimes(3)
    })

    it('should handle onCancel and onOk being the same function', () => {
      // Arrange
      const handler = vi.fn()
      renderDrawer({ onCancel: handler, onOk: handler })

      // Act
      fireEvent.click(screen.getByText('common.operation.cancel'))
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })
})
