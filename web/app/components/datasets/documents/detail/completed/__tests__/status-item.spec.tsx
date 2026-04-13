import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatusItem from '../status-item'

describe('StatusItem', () => {
  const defaultItem = {
    value: '1',
    name: 'Test Status',
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<StatusItem item={defaultItem} selected={false} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render item name', () => {
      render(<StatusItem item={defaultItem} selected={false} />)

      expect(screen.getByText('Test Status')).toBeInTheDocument()
    })

    it('should render with correct styling classes', () => {
      const { container } = render(<StatusItem item={defaultItem} selected={false} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-between')
    })
  })

  describe('Props', () => {
    it('should show check icon when selected is true', () => {
      const { container } = render(<StatusItem item={defaultItem} selected={true} />)

      // Assert - RiCheckLine icon should be present
      const checkIcon = container.querySelector('.text-text-accent')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should not show check icon when selected is false', () => {
      const { container } = render(<StatusItem item={defaultItem} selected={false} />)

      // Assert - RiCheckLine icon should not be present
      const checkIcon = container.querySelector('.text-text-accent')
      expect(checkIcon).not.toBeInTheDocument()
    })

    it('should render different item names', () => {
      const item = { value: '2', name: 'Different Status' }
      render(<StatusItem item={item} selected={false} />)

      expect(screen.getByText('Different Status')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should render consistently with same props', () => {
      const { container: container1 } = render(<StatusItem item={defaultItem} selected={true} />)
      const { container: container2 } = render(<StatusItem item={defaultItem} selected={true} />)

      expect(container1.textContent).toBe(container2.textContent)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty item name', () => {
      const emptyItem = { value: '1', name: '' }

      const { container } = render(<StatusItem item={emptyItem} selected={false} />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle special characters in item name', () => {
      const specialItem = { value: '1', name: 'Status <>&"' }

      render(<StatusItem item={specialItem} selected={false} />)

      expect(screen.getByText('Status <>&"')).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender } = render(<StatusItem item={defaultItem} selected={false} />)

      rerender(<StatusItem item={defaultItem} selected={true} />)

      expect(screen.getByText('Test Status')).toBeInTheDocument()
    })
  })
})
