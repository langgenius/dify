import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SortHeader from './sort-header'

describe('SortHeader', () => {
  const defaultProps = {
    field: 'name' as const,
    label: 'File Name',
    currentSortField: null,
    sortOrder: 'desc' as const,
    onSort: vi.fn(),
  }

  describe('rendering', () => {
    it('should render the label', () => {
      render(<SortHeader {...defaultProps} />)
      expect(screen.getByText('File Name')).toBeInTheDocument()
    })

    it('should render the sort icon', () => {
      const { container } = render(<SortHeader {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('inactive state', () => {
    it('should have disabled text color when not active', () => {
      const { container } = render(<SortHeader {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-disabled')
    })

    it('should not be rotated when not active', () => {
      const { container } = render(<SortHeader {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).not.toHaveClass('rotate-180')
    })
  })

  describe('active state', () => {
    it('should have tertiary text color when active', () => {
      const { container } = render(
        <SortHeader {...defaultProps} currentSortField="name" />,
      )
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('text-text-tertiary')
    })

    it('should not be rotated when active and desc', () => {
      const { container } = render(
        <SortHeader {...defaultProps} currentSortField="name" sortOrder="desc" />,
      )
      const icon = container.querySelector('svg')
      expect(icon).not.toHaveClass('rotate-180')
    })

    it('should be rotated when active and asc', () => {
      const { container } = render(
        <SortHeader {...defaultProps} currentSortField="name" sortOrder="asc" />,
      )
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('rotate-180')
    })
  })

  describe('interaction', () => {
    it('should call onSort when clicked', () => {
      const onSort = vi.fn()
      render(<SortHeader {...defaultProps} onSort={onSort} />)

      fireEvent.click(screen.getByText('File Name'))

      expect(onSort).toHaveBeenCalledWith('name')
    })

    it('should call onSort with correct field', () => {
      const onSort = vi.fn()
      render(<SortHeader {...defaultProps} field="word_count" onSort={onSort} />)

      fireEvent.click(screen.getByText('File Name'))

      expect(onSort).toHaveBeenCalledWith('word_count')
    })
  })

  describe('different fields', () => {
    it('should work with word_count field', () => {
      render(
        <SortHeader
          {...defaultProps}
          field="word_count"
          label="Words"
          currentSortField="word_count"
        />,
      )
      expect(screen.getByText('Words')).toBeInTheDocument()
    })

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
