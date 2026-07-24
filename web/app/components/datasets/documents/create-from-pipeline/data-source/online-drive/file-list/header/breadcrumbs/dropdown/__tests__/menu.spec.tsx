import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Menu from '../menu'

describe('Menu', () => {
  const defaultProps = {
    breadcrumbs: ['Folder A', 'Folder B', 'Folder C'],
    startIndex: 1,
    onBreadcrumbClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verify all breadcrumb items are displayed
  describe('Rendering', () => {
    it('should render all breadcrumb items', () => {
      render(<Menu {...defaultProps} />)

      expect(screen.getByText('Folder A')).toBeInTheDocument()
      expect(screen.getByText('Folder B')).toBeInTheDocument()
      expect(screen.getByText('Folder C')).toBeInTheDocument()
    })

    it('should render empty list when no breadcrumbs provided', () => {
      const { container } = render(
        <Menu breadcrumbs={[]} startIndex={0} onBreadcrumbClick={vi.fn()} />,
      )

      const menuContainer = container.firstElementChild
      expect(menuContainer?.children).toHaveLength(0)
    })
  })

  // Index mapping: startIndex offsets are applied correctly
  describe('Index Mapping', () => {
    it('should pass correct index (startIndex + offset) to each item', () => {
      render(<Menu {...defaultProps} />)

      fireEvent.click(screen.getByText('Folder A'))
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(1)

      fireEvent.click(screen.getByText('Folder B'))
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(2)

      fireEvent.click(screen.getByText('Folder C'))
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(3)
    })

    it('should offset from startIndex of zero', () => {
      render(
        <Menu
          breadcrumbs={['First', 'Second']}
          startIndex={0}
          onBreadcrumbClick={defaultProps.onBreadcrumbClick}
        />,
      )

      fireEvent.click(screen.getByText('First'))
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(0)

      fireEvent.click(screen.getByText('Second'))
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(1)
    })
  })

  // User interactions: clicking items triggers the callback
  describe('User Interactions', () => {
    it('should call onBreadcrumbClick with correct index when item clicked', () => {
      render(<Menu {...defaultProps} />)

      fireEvent.click(screen.getByText('Folder B'))

      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledOnce()
      expect(defaultProps.onBreadcrumbClick).toHaveBeenCalledWith(2)
    })
  })
})
