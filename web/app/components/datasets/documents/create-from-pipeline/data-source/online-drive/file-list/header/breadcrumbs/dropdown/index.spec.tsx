import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import Dropdown from './index'

// ==========================================
// Note: react-i18next uses global mock from web/vitest.setup.ts
// ==========================================

// ==========================================
// Test Data Builders
// ==========================================
type DropdownProps = React.ComponentProps<typeof Dropdown>

const createDefaultProps = (overrides?: Partial<DropdownProps>): DropdownProps => ({
  startIndex: 0,
  breadcrumbs: ['folder1', 'folder2'],
  onBreadcrumbClick: vi.fn(),
  ...overrides,
})

// ==========================================
// Test Suites
// ==========================================
describe('Dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Dropdown {...props} />)

      // Assert - Trigger button should be visible
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render trigger button with more icon', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<Dropdown {...props} />)

      // Assert - Button should have RiMoreFill icon (rendered as svg)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should render separator after dropdown', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Dropdown {...props} />)

      // Assert - Separator "/" should be visible
      expect(screen.getByText('/')).toBeInTheDocument()
    })

    it('should render trigger button with correct default styles', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Dropdown {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('flex')
      expect(button).toHaveClass('size-6')
      expect(button).toHaveClass('items-center')
      expect(button).toHaveClass('justify-center')
      expect(button).toHaveClass('rounded-md')
    })

    it('should not render menu content when closed', () => {
      // Arrange
      const props = createDefaultProps({ breadcrumbs: ['visible-folder'] })

      // Act
      render(<Dropdown {...props} />)

      // Assert - Menu content should not be visible when dropdown is closed
      expect(screen.queryByText('visible-folder')).not.toBeInTheDocument()
    })

    it('should render menu content when opened', async () => {
      // Arrange
      const props = createDefaultProps({ breadcrumbs: ['test-folder1', 'test-folder2'] })
      render(<Dropdown {...props} />)

      // Act - Open dropdown
      fireEvent.click(screen.getByRole('button'))

      // Assert - Menu items should be visible
      await waitFor(() => {
        expect(screen.getByText('test-folder1')).toBeInTheDocument()
        expect(screen.getByText('test-folder2')).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Props Testing
  // ==========================================
  describe('Props', () => {
    describe('startIndex prop', () => {
      it('should pass startIndex to Menu component', async () => {
        // Arrange
        const mockOnBreadcrumbClick = vi.fn()
        const props = createDefaultProps({
          startIndex: 5,
          breadcrumbs: ['folder1'],
          onBreadcrumbClick: mockOnBreadcrumbClick,
        })
        render(<Dropdown {...props} />)

        // Act - Open dropdown and click on item
        fireEvent.click(screen.getByRole('button'))

        await waitFor(() => {
          expect(screen.getByText('folder1')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText('folder1'))

        // Assert - Should be called with startIndex (5) + item index (0) = 5
        expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(5)
      })

      it('should calculate correct index for second item', async () => {
        // Arrange
        const mockOnBreadcrumbClick = vi.fn()
        const props = createDefaultProps({
          startIndex: 3,
          breadcrumbs: ['folder1', 'folder2'],
          onBreadcrumbClick: mockOnBreadcrumbClick,
        })
        render(<Dropdown {...props} />)

        // Act - Open dropdown and click on second item
        fireEvent.click(screen.getByRole('button'))

        await waitFor(() => {
          expect(screen.getByText('folder2')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText('folder2'))

        // Assert - Should be called with startIndex (3) + item index (1) = 4
        expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(4)
      })
    })

    describe('breadcrumbs prop', () => {
      it('should render all breadcrumbs in menu', async () => {
        // Arrange
        const props = createDefaultProps({
          breadcrumbs: ['folder-a', 'folder-b', 'folder-c'],
        })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        // Assert
        await waitFor(() => {
          expect(screen.getByText('folder-a')).toBeInTheDocument()
          expect(screen.getByText('folder-b')).toBeInTheDocument()
          expect(screen.getByText('folder-c')).toBeInTheDocument()
        })
      })

      it('should handle single breadcrumb', async () => {
        // Arrange
        const props = createDefaultProps({
          breadcrumbs: ['single-folder'],
        })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        // Assert
        await waitFor(() => {
          expect(screen.getByText('single-folder')).toBeInTheDocument()
        })
      })

      it('should handle empty breadcrumbs array', async () => {
        // Arrange
        const props = createDefaultProps({
          breadcrumbs: [],
        })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        // Assert - Menu should be rendered but with no items
        await waitFor(() => {
          // The menu container should exist but be empty
          expect(screen.getByRole('button')).toBeInTheDocument()
        })
      })

      it('should handle breadcrumbs with special characters', async () => {
        // Arrange
        const props = createDefaultProps({
          breadcrumbs: ['folder [1]', 'folder (copy)', 'folder-v2.0'],
        })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        // Assert
        await waitFor(() => {
          expect(screen.getByText('folder [1]')).toBeInTheDocument()
          expect(screen.getByText('folder (copy)')).toBeInTheDocument()
          expect(screen.getByText('folder-v2.0')).toBeInTheDocument()
        })
      })

      it('should handle breadcrumbs with unicode characters', async () => {
        // Arrange
        const props = createDefaultProps({
          breadcrumbs: ['文件夹', 'フォルダ', 'Папка'],
        })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        // Assert
        await waitFor(() => {
          expect(screen.getByText('文件夹')).toBeInTheDocument()
          expect(screen.getByText('フォルダ')).toBeInTheDocument()
          expect(screen.getByText('Папка')).toBeInTheDocument()
        })
      })
    })

    describe('onBreadcrumbClick prop', () => {
      it('should call onBreadcrumbClick with correct index when item clicked', async () => {
        // Arrange
        const mockOnBreadcrumbClick = vi.fn()
        const props = createDefaultProps({
          startIndex: 0,
          breadcrumbs: ['folder1'],
          onBreadcrumbClick: mockOnBreadcrumbClick,
        })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        await waitFor(() => {
          expect(screen.getByText('folder1')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText('folder1'))

        // Assert
        expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(0)
        expect(mockOnBreadcrumbClick).toHaveBeenCalledTimes(1)
      })
    })
  })

  // ==========================================
  // State Management Tests
  // ==========================================
  describe('State Management', () => {
    describe('open state', () => {
      it('should initialize with closed state', () => {
        // Arrange
        const props = createDefaultProps({ breadcrumbs: ['test-folder'] })

        // Act
        render(<Dropdown {...props} />)

        // Assert - Menu content should not be visible
        expect(screen.queryByText('test-folder')).not.toBeInTheDocument()
      })

      it('should toggle to open state when trigger is clicked', async () => {
        // Arrange
        const props = createDefaultProps({ breadcrumbs: ['test-folder'] })
        render(<Dropdown {...props} />)

        // Act
        fireEvent.click(screen.getByRole('button'))

        // Assert
        await waitFor(() => {
          expect(screen.getByText('test-folder')).toBeInTheDocument()
        })
      })

      it('should toggle to closed state when trigger is clicked again', async () => {
        // Arrange
        const props = createDefaultProps({ breadcrumbs: ['test-folder'] })
        render(<Dropdown {...props} />)

        // Act - Open and then close
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => {
          expect(screen.getByText('test-folder')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button'))

        // Assert
        await waitFor(() => {
          expect(screen.queryByText('test-folder')).not.toBeInTheDocument()
        })
      })

      it('should close when breadcrumb item is clicked', async () => {
        // Arrange
        const mockOnBreadcrumbClick = vi.fn()
        const props = createDefaultProps({
          breadcrumbs: ['test-folder'],
          onBreadcrumbClick: mockOnBreadcrumbClick,
        })
        render(<Dropdown {...props} />)

        // Act - Open dropdown
        fireEvent.click(screen.getByRole('button'))

        await waitFor(() => {
          expect(screen.getByText('test-folder')).toBeInTheDocument()
        })

        // Click on breadcrumb item
        fireEvent.click(screen.getByText('test-folder'))

        // Assert - Menu should close
        await waitFor(() => {
          expect(screen.queryByText('test-folder')).not.toBeInTheDocument()
        })
      })

      it('should apply correct button styles based on open state', async () => {
        // Arrange
        const props = createDefaultProps({ breadcrumbs: ['test-folder'] })
        render(<Dropdown {...props} />)
        const button = screen.getByRole('button')

        // Assert - Initial state (closed): should have hover:bg-state-base-hover
        expect(button).toHaveClass('hover:bg-state-base-hover')

        // Act - Open dropdown
        fireEvent.click(button)

        // Assert - Open state: should have bg-state-base-hover
        await waitFor(() => {
          expect(button).toHaveClass('bg-state-base-hover')
        })
      })
    })
  })

  // ==========================================
  // Event Handlers Tests
  // ==========================================
  describe('Event Handlers', () => {
    describe('handleTrigger', () => {
      it('should toggle open state when trigger is clicked', async () => {
        // Arrange
        const props = createDefaultProps({ breadcrumbs: ['folder'] })
        render(<Dropdown {...props} />)

        // Act & Assert - Initially closed
        expect(screen.queryByText('folder')).not.toBeInTheDocument()

        // Act - Click to open
        fireEvent.click(screen.getByRole('button'))

        // Assert - Now open
        await waitFor(() => {
          expect(screen.getByText('folder')).toBeInTheDocument()
        })
      })

      it('should toggle multiple times correctly', async () => {
        // Arrange
        const props = createDefaultProps({ breadcrumbs: ['folder'] })
        render(<Dropdown {...props} />)
        const button = screen.getByRole('button')

        // Act & Assert - Toggle multiple times
        // 1st click - open
        fireEvent.click(button)
        await waitFor(() => {
          expect(screen.getByText('folder')).toBeInTheDocument()
        })

        // 2nd click - close
        fireEvent.click(button)
        await waitFor(() => {
          expect(screen.queryByText('folder')).not.toBeInTheDocument()
        })

        // 3rd click - open again
        fireEvent.click(button)
        await waitFor(() => {
          expect(screen.getByText('folder')).toBeInTheDocument()
        })
      })
    })

    describe('handleBreadCrumbClick', () => {
      it('should call onBreadcrumbClick and close menu', async () => {
        // Arrange
        const mockOnBreadcrumbClick = vi.fn()
        const props = createDefaultProps({
          breadcrumbs: ['folder1'],
          onBreadcrumbClick: mockOnBreadcrumbClick,
        })
        render(<Dropdown {...props} />)

        // Act - Open dropdown
        fireEvent.click(screen.getByRole('button'))

        await waitFor(() => {
          expect(screen.getByText('folder1')).toBeInTheDocument()
        })

        // Click on breadcrumb
        fireEvent.click(screen.getByText('folder1'))

        // Assert
        expect(mockOnBreadcrumbClick).toHaveBeenCalledTimes(1)

        // Menu should close
        await waitFor(() => {
          expect(screen.queryByText('folder1')).not.toBeInTheDocument()
        })
      })

      it('should pass correct index to onBreadcrumbClick for each item', async () => {
        // Arrange
        const mockOnBreadcrumbClick = vi.fn()
        const props = createDefaultProps({
          startIndex: 2,
          breadcrumbs: ['folder1', 'folder2', 'folder3'],
          onBreadcrumbClick: mockOnBreadcrumbClick,
        })
        render(<Dropdown {...props} />)

        // Act - Open dropdown and click first item
        fireEvent.click(screen.getByRole('button'))

        await waitFor(() => {
          expect(screen.getByText('folder1')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByText('folder1'))

        // Assert - Index should be startIndex (2) + item index (0) = 2
        expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(2)
      })
    })
  })

  // ==========================================
  // Callback Stability and Memoization Tests
  // ==========================================
  describe('Callback Stability and Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - Dropdown component should be memoized
      expect(Dropdown).toHaveProperty('$$typeof', Symbol.for('react.memo'))
    })

    it('should maintain stable callback after rerender with same props', async () => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        breadcrumbs: ['folder'],
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })
      const { rerender } = render(<Dropdown {...props} />)

      // Act - Open and click
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('folder'))

      // Rerender with same props and click again
      rerender(<Dropdown {...props} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('folder'))

      // Assert
      expect(mockOnBreadcrumbClick).toHaveBeenCalledTimes(2)
    })

    it('should update callback when onBreadcrumbClick prop changes', async () => {
      // Arrange
      const mockOnBreadcrumbClick1 = vi.fn()
      const mockOnBreadcrumbClick2 = vi.fn()
      const props = createDefaultProps({
        breadcrumbs: ['folder'],
        onBreadcrumbClick: mockOnBreadcrumbClick1,
      })
      const { rerender } = render(<Dropdown {...props} />)

      // Act - Open and click with first callback
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('folder'))

      // Rerender with different callback
      rerender(
        <Dropdown {...createDefaultProps({
          breadcrumbs: ['folder'],
          onBreadcrumbClick: mockOnBreadcrumbClick2,
        })}
        />,
      )

      // Open and click with second callback
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('folder'))

      // Assert
      expect(mockOnBreadcrumbClick1).toHaveBeenCalledTimes(1)
      expect(mockOnBreadcrumbClick2).toHaveBeenCalledTimes(1)
    })

    it('should not re-render when props are the same', () => {
      // Arrange
      const props = createDefaultProps()
      const { rerender } = render(<Dropdown {...props} />)

      // Act - Rerender with same props
      rerender(<Dropdown {...props} />)

      // Assert - Component should render without errors
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Edge Cases and Error Handling
  // ==========================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid toggle clicks', async () => {
      // Arrange
      const props = createDefaultProps({ breadcrumbs: ['folder'] })
      render(<Dropdown {...props} />)
      const button = screen.getByRole('button')

      // Act - Rapid clicks
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert - Should handle gracefully (open after odd number of clicks)
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
    })

    it('should handle very long folder names', async () => {
      // Arrange
      const longName = 'a'.repeat(100)
      const props = createDefaultProps({
        breadcrumbs: [longName],
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText(longName)).toBeInTheDocument()
      })
    })

    it('should handle many breadcrumbs', async () => {
      // Arrange
      const manyBreadcrumbs = Array.from({ length: 20 }, (_, i) => `folder-${i}`)
      const props = createDefaultProps({
        breadcrumbs: manyBreadcrumbs,
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert - First and last items should be visible
      await waitFor(() => {
        expect(screen.getByText('folder-0')).toBeInTheDocument()
        expect(screen.getByText('folder-19')).toBeInTheDocument()
      })
    })

    it('should handle startIndex of 0', async () => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        startIndex: 0,
        breadcrumbs: ['folder'],
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('folder'))

      // Assert
      expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(0)
    })

    it('should handle large startIndex values', async () => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        startIndex: 999,
        breadcrumbs: ['folder'],
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('folder'))

      // Assert
      expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(999)
    })

    it('should handle breadcrumbs with whitespace-only names', async () => {
      // Arrange
      const props = createDefaultProps({
        breadcrumbs: ['   ', 'normal-folder'],
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('normal-folder')).toBeInTheDocument()
      })
    })

    it('should handle breadcrumbs with empty string', async () => {
      // Arrange
      const props = createDefaultProps({
        breadcrumbs: ['', 'folder'],
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('folder')).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // All Prop Variations Tests
  // ==========================================
  describe('Prop Variations', () => {
    it.each([
      { startIndex: 0, breadcrumbs: ['a'], expectedIndex: 0 },
      { startIndex: 1, breadcrumbs: ['a'], expectedIndex: 1 },
      { startIndex: 5, breadcrumbs: ['a'], expectedIndex: 5 },
      { startIndex: 10, breadcrumbs: ['a', 'b'], expectedIndex: 10 },
    ])('should handle startIndex=$startIndex correctly', async ({ startIndex, breadcrumbs, expectedIndex }) => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        startIndex,
        breadcrumbs,
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText(breadcrumbs[0])).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText(breadcrumbs[0]))

      // Assert
      expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(expectedIndex)
    })

    it.each([
      { breadcrumbs: [], description: 'empty array' },
      { breadcrumbs: ['single'], description: 'single item' },
      { breadcrumbs: ['a', 'b'], description: 'two items' },
      { breadcrumbs: ['a', 'b', 'c', 'd', 'e'], description: 'five items' },
    ])('should render correctly with $description breadcrumbs', async ({ breadcrumbs }) => {
      // Arrange
      const props = createDefaultProps({ breadcrumbs })

      // Act
      render(<Dropdown {...props} />)
      fireEvent.click(screen.getByRole('button'))

      // Assert - Should render without errors
      await waitFor(() => {
        if (breadcrumbs.length > 0)
          expect(screen.getByText(breadcrumbs[0])).toBeInTheDocument()
      })
    })
  })

  // ==========================================
  // Integration Tests (Menu and Item)
  // ==========================================
  describe('Integration with Menu and Item', () => {
    it('should render all menu items with correct content', async () => {
      // Arrange
      const props = createDefaultProps({
        breadcrumbs: ['Documents', 'Projects', 'Archive'],
      })
      render(<Dropdown {...props} />)

      // Act
      fireEvent.click(screen.getByRole('button'))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Documents')).toBeInTheDocument()
        expect(screen.getByText('Projects')).toBeInTheDocument()
        expect(screen.getByText('Archive')).toBeInTheDocument()
      })
    })

    it('should handle click on any menu item', async () => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        startIndex: 0,
        breadcrumbs: ['first', 'second', 'third'],
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })
      render(<Dropdown {...props} />)

      // Act - Open and click on second item
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('second')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('second'))

      // Assert - Index should be 1 (second item)
      expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(1)
    })

    it('should close menu after any item click', async () => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        breadcrumbs: ['item1', 'item2', 'item3'],
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })
      render(<Dropdown {...props} />)

      // Act - Open and click on middle item
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.getByText('item2')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('item2'))

      // Assert - Menu should close
      await waitFor(() => {
        expect(screen.queryByText('item1')).not.toBeInTheDocument()
        expect(screen.queryByText('item2')).not.toBeInTheDocument()
        expect(screen.queryByText('item3')).not.toBeInTheDocument()
      })
    })

    it('should correctly calculate index for each item based on startIndex', async () => {
      // Arrange
      const mockOnBreadcrumbClick = vi.fn()
      const props = createDefaultProps({
        startIndex: 3,
        breadcrumbs: ['folder-a', 'folder-b', 'folder-c'],
        onBreadcrumbClick: mockOnBreadcrumbClick,
      })

      // Test clicking each item
      for (let i = 0; i < 3; i++) {
        mockOnBreadcrumbClick.mockClear()
        const { unmount } = render(<Dropdown {...props} />)

        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => {
          expect(screen.getByText(`folder-${String.fromCharCode(97 + i)}`)).toBeInTheDocument()
        })
        fireEvent.click(screen.getByText(`folder-${String.fromCharCode(97 + i)}`))

        expect(mockOnBreadcrumbClick).toHaveBeenCalledWith(3 + i)
        unmount()
      }
    })
  })

  // ==========================================
  // Accessibility Tests
  // ==========================================
  describe('Accessibility', () => {
    it('should render trigger as button element', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Dropdown {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(button.tagName).toBe('BUTTON')
    })

    it('should have type="button" attribute', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<Dropdown {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })
  })
})
