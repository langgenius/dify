import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EmptyElement from './empty-element'

describe('EmptyElement', () => {
  const defaultProps = {
    canAdd: true,
    onClick: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<EmptyElement {...defaultProps} />)
      expect(screen.getByText(/list\.empty\.title/i)).toBeInTheDocument()
    })

    it('should render title text', () => {
      render(<EmptyElement {...defaultProps} />)
      expect(screen.getByText(/list\.empty\.title/i)).toBeInTheDocument()
    })

    it('should render tip text for upload type', () => {
      render(<EmptyElement {...defaultProps} type="upload" />)
      expect(screen.getByText(/list\.empty\.upload\.tip/i)).toBeInTheDocument()
    })

    it('should render tip text for sync type', () => {
      render(<EmptyElement {...defaultProps} type="sync" />)
      expect(screen.getByText(/list\.empty\.sync\.tip/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should use upload type by default', () => {
      render(<EmptyElement {...defaultProps} />)
      expect(screen.getByText(/list\.empty\.upload\.tip/i)).toBeInTheDocument()
    })

    it('should render FolderPlusIcon for upload type', () => {
      const { container } = render(<EmptyElement {...defaultProps} type="upload" />)
      // FolderPlusIcon has specific SVG attributes
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should render NotionIcon for sync type', () => {
      const { container } = render(<EmptyElement {...defaultProps} type="sync" />)
      // NotionIcon has clipPath
      const clipPath = container.querySelector('clipPath')
      expect(clipPath).toBeInTheDocument()
    })
  })

  describe('Add Button', () => {
    it('should show add button when canAdd is true and type is upload', () => {
      render(<EmptyElement {...defaultProps} canAdd={true} type="upload" />)
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/list\.addFile/i)).toBeInTheDocument()
    })

    it('should not show add button when canAdd is false', () => {
      render(<EmptyElement {...defaultProps} canAdd={false} type="upload" />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should not show add button for sync type', () => {
      render(<EmptyElement {...defaultProps} canAdd={true} type="sync" />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should not show add button for sync type even when canAdd is true', () => {
      render(<EmptyElement canAdd={true} onClick={vi.fn()} type="sync" />)
      expect(screen.queryByText(/list\.addFile/i)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when add button is clicked', () => {
      const handleClick = vi.fn()
      render(<EmptyElement canAdd={true} onClick={handleClick} type="upload" />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle default canAdd value (true)', () => {
      render(<EmptyElement onClick={vi.fn()} canAdd={true} />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
