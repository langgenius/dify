import { fireEvent, render, screen } from '@testing-library/react'
import MenuDialog from './menu-dialog'

describe('MenuDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render children when show is true', () => {
      // Act
      render(
        <MenuDialog show={true} onClose={vi.fn()}>
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )

      // Assert
      expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    })

    it('should not render children when show is false', () => {
      // Act
      render(
        <MenuDialog show={false} onClose={vi.fn()}>
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )

      // Assert
      expect(screen.queryByTestId('dialog-content')).not.toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Act
      render(
        <MenuDialog show={true} onClose={vi.fn()} className="custom-class">
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )

      // Assert
      const panel = screen.getByRole('dialog').querySelector('.custom-class')
      expect(panel).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should call onClose when Escape key is pressed', () => {
      // Arrange
      const onClose = vi.fn()
      render(
        <MenuDialog show={true} onClose={onClose}>
          <div>Content</div>
        </MenuDialog>,
      )

      // Act
      fireEvent.keyDown(document, { key: 'Escape' })

      // Assert
      expect(onClose).toHaveBeenCalled()
    })

    it('should not call onClose when a key other than Escape is pressed', () => {
      // Arrange
      const onClose = vi.fn()
      render(
        <MenuDialog show={true} onClose={onClose}>
          <div>Content</div>
        </MenuDialog>,
      )

      // Act
      fireEvent.keyDown(document, { key: 'Enter' })

      // Assert
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should not crash when Escape is pressed and onClose is not provided', () => {
      // Arrange
      render(
        <MenuDialog show={true}>
          <div data-testid="dialog-content">Content</div>
        </MenuDialog>,
      )

      // Act & Assert
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    })
  })
})
