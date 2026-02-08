import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatusItem from './status-item'

describe('StatusItem', () => {
  const defaultItem = {
    value: '1',
    name: 'Test Status',
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(<StatusItem item={defaultItem} selected={false} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render item name', () => {
      // Arrange & Act
      render(<StatusItem item={defaultItem} selected={false} />)

      // Assert
      expect(screen.getByText('Test Status')).toBeInTheDocument()
    })

    it('should render with correct styling classes', () => {
      // Arrange & Act
      const { container } = render(<StatusItem item={defaultItem} selected={false} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-between')
    })
  })

  // Props tests
  describe('Props', () => {
    it('should show check icon when selected is true', () => {
      // Arrange & Act
      const { container } = render(<StatusItem item={defaultItem} selected={true} />)

      // Assert - RiCheckLine icon should be present
      const checkIcon = container.querySelector('.text-text-accent')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should not show check icon when selected is false', () => {
      // Arrange & Act
      const { container } = render(<StatusItem item={defaultItem} selected={false} />)

      // Assert - RiCheckLine icon should not be present
      const checkIcon = container.querySelector('.text-text-accent')
      expect(checkIcon).not.toBeInTheDocument()
    })

    it('should render different item names', () => {
      // Arrange & Act
      const item = { value: '2', name: 'Different Status' }
      render(<StatusItem item={item} selected={false} />)

      // Assert
      expect(screen.getByText('Different Status')).toBeInTheDocument()
    })
  })

  // Memoization tests
  describe('Memoization', () => {
    it('should render consistently with same props', () => {
      // Arrange & Act
      const { container: container1 } = render(<StatusItem item={defaultItem} selected={true} />)
      const { container: container2 } = render(<StatusItem item={defaultItem} selected={true} />)

      // Assert
      expect(container1.textContent).toBe(container2.textContent)
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty item name', () => {
      // Arrange
      const emptyItem = { value: '1', name: '' }

      // Act
      const { container } = render(<StatusItem item={emptyItem} selected={false} />)

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle special characters in item name', () => {
      // Arrange
      const specialItem = { value: '1', name: 'Status <>&"' }

      // Act
      render(<StatusItem item={specialItem} selected={false} />)

      // Assert
      expect(screen.getByText('Status <>&"')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender } = render(<StatusItem item={defaultItem} selected={false} />)

      // Act
      rerender(<StatusItem item={defaultItem} selected={true} />)

      // Assert
      expect(screen.getByText('Test Status')).toBeInTheDocument()
    })
  })
})
