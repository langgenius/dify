import type { IItem } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import Collapse from './index'

describe('Collapse', () => {
  const mockItems: IItem[] = [
    { key: '1', name: 'Item 1' },
    { key: '2', name: 'Item 2' },
  ]

  const mockRenderItem = (item: IItem) => (
    <div data-testid={`item-${item.key}`}>
      {item.name}
    </div>
  )

  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title and initially closed state', () => {
      // Act
      const { container } = render(
        <Collapse
          title="Test Title"
          items={mockItems}
          renderItem={mockRenderItem}
        />,
      )

      // Assert
      expect(screen.getByText('Test Title')).toBeInTheDocument()
      expect(screen.queryByTestId('item-1')).not.toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should apply custom wrapperClassName', () => {
      // Act
      const { container } = render(
        <Collapse
          title="Test Title"
          items={[]}
          renderItem={mockRenderItem}
          wrapperClassName="custom-class"
        />,
      )

      // Assert
      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('Interactions', () => {
    it('should toggle content open and closed', () => {
      // Act & Assert
      render(
        <Collapse
          title="Test Title"
          items={mockItems}
          renderItem={mockRenderItem}
        />,
      )

      // Initially closed
      expect(screen.queryByTestId('item-1')).not.toBeInTheDocument()

      // Click to open
      fireEvent.click(screen.getByText('Test Title'))
      expect(screen.getByTestId('item-1')).toBeInTheDocument()
      expect(screen.getByTestId('item-2')).toBeInTheDocument()

      // Click to close
      fireEvent.click(screen.getByText('Test Title'))
      expect(screen.queryByTestId('item-1')).not.toBeInTheDocument()
    })

    it('should handle item selection', () => {
      // Arrange
      render(
        <Collapse
          title="Test Title"
          items={mockItems}
          renderItem={mockRenderItem}
          onSelect={mockOnSelect}
        />,
      )

      // Act
      fireEvent.click(screen.getByText('Test Title'))
      const item1 = screen.getByTestId('item-1')
      fireEvent.click(item1)

      // Assert
      expect(mockOnSelect).toHaveBeenCalledTimes(1)
      expect(mockOnSelect).toHaveBeenCalledWith(mockItems[0])
    })

    it('should not crash when onSelect is undefined and item is clicked', () => {
      // Arrange
      render(
        <Collapse
          title="Test Title"
          items={mockItems}
          renderItem={mockRenderItem}
        />,
      )

      // Act
      fireEvent.click(screen.getByText('Test Title'))
      const item1 = screen.getByTestId('item-1')
      fireEvent.click(item1)

      // Assert
      // Should not throw
      expect(screen.getByTestId('item-1')).toBeInTheDocument()
    })
  })
})
