import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SortHeader from '../sort-header'

describe('SortHeader', () => {
  const defaultProps = {
    field: 'created_at' as const,
    label: 'Upload Time',
    currentSortField: null,
    sortOrder: 'desc' as const,
    onSort: vi.fn(),
  }

  describe('rendering', () => {
    it('should render the label', () => {
      render(<SortHeader {...defaultProps} />)
      expect(screen.getByText('Upload Time')).toBeInTheDocument()
    })

    it('should render the sort icon', () => {
      const { container } = render(<SortHeader {...defaultProps} />)
      const icon = container.querySelector('.i-ri-arrow-down-line')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('inactive state', () => {
    it('should have disabled text color when not active', () => {
      const { container } = render(<SortHeader {...defaultProps} />)
      const icon = container.querySelector('.i-ri-arrow-down-line')
      expect(icon).toHaveClass('text-text-disabled')
    })

    it('should not be rotated when not active', () => {
      const { container } = render(<SortHeader {...defaultProps} />)
      const icon = container.querySelector('.i-ri-arrow-down-line')
      expect(icon).not.toHaveClass('rotate-180')
    })
  })

  describe('active state', () => {
    it('should have tertiary text color when active', () => {
      const { container } = render(
        <SortHeader {...defaultProps} currentSortField="created_at" />,
      )
      const icon = container.querySelector('.i-ri-arrow-down-line')
      expect(icon).toHaveClass('text-text-tertiary')
    })

    it('should not be rotated when active and desc', () => {
      const { container } = render(
        <SortHeader {...defaultProps} currentSortField="created_at" sortOrder="desc" />,
      )
      const icon = container.querySelector('.i-ri-arrow-down-line')
      expect(icon).not.toHaveClass('rotate-180')
    })

    it('should be rotated when active and asc', () => {
      const { container } = render(
        <SortHeader {...defaultProps} currentSortField="created_at" sortOrder="asc" />,
      )
      const icon = container.querySelector('.i-ri-arrow-down-line')
      expect(icon).toHaveClass('rotate-180')
    })
  })

  describe('interaction', () => {
    it('should call onSort when clicked', () => {
      const onSort = vi.fn()
      render(<SortHeader {...defaultProps} onSort={onSort} />)

      fireEvent.click(screen.getByText('Upload Time'))

      expect(onSort).toHaveBeenCalledWith('created_at')
    })

    it('should call onSort with correct field', () => {
      const onSort = vi.fn()
      render(<SortHeader {...defaultProps} field="hit_count" onSort={onSort} />)

      fireEvent.click(screen.getByText('Upload Time'))

      expect(onSort).toHaveBeenCalledWith('hit_count')
    })
  })

  describe('different fields', () => {
    it('should work with hit_count field', () => {
      render(
        <SortHeader
          {...defaultProps}
          field="hit_count"
          label="Hit Count"
          currentSortField="hit_count"
        />,
      )
      expect(screen.getByText('Hit Count')).toBeInTheDocument()
    })

    it('should work with created_at field', () => {
      render(
        <SortHeader
          {...defaultProps}
          field="created_at"
          label="Upload Time"
          currentSortField="created_at"
        />,
      )
      expect(screen.getByText('Upload Time')).toBeInTheDocument()
    })
  })
})
