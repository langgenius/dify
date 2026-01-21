import type { MetadataItem } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import SelectMetadata from './select-metadata'

type IconProps = {
  className?: string
}

// Mock getIcon utility
vi.mock('../utils/get-icon', () => ({
  getIcon: () => (props: IconProps) => <span data-testid="icon" className={props.className}>Icon</span>,
}))

describe('SelectMetadata', () => {
  const mockList: MetadataItem[] = [
    { id: '1', name: 'field_one', type: DataType.string },
    { id: '2', name: 'field_two', type: DataType.number },
    { id: '3', name: 'field_three', type: DataType.time },
  ]

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render search input', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should render all metadata items', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByText('field_one')).toBeInTheDocument()
      expect(screen.getByText('field_two')).toBeInTheDocument()
      expect(screen.getByText('field_three')).toBeInTheDocument()
    })

    it('should render new action button', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      // New action button should be present (from i18n)
      expect(screen.getByText(/new/i)).toBeInTheDocument()
    })

    it('should render manage action button', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      // Manage action button should be present (from i18n)
      expect(screen.getByText(/manage/i)).toBeInTheDocument()
    })

    it('should display type for each item', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getAllByText(DataType.string).length).toBeGreaterThan(0)
      expect(screen.getAllByText(DataType.number).length).toBeGreaterThan(0)
      expect(screen.getAllByText(DataType.time).length).toBeGreaterThan(0)
    })
  })

  describe('Search Functionality', () => {
    it('should filter items based on search query', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      const searchInput = screen.getByRole('textbox')
      fireEvent.change(searchInput, { target: { value: 'one' } })

      expect(screen.getByText('field_one')).toBeInTheDocument()
      expect(screen.queryByText('field_two')).not.toBeInTheDocument()
      expect(screen.queryByText('field_three')).not.toBeInTheDocument()
    })

    it('should be case insensitive search', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      const searchInput = screen.getByRole('textbox')
      fireEvent.change(searchInput, { target: { value: 'ONE' } })

      expect(screen.getByText('field_one')).toBeInTheDocument()
    })

    it('should show all items when search is cleared', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      const searchInput = screen.getByRole('textbox')

      // Search for something
      fireEvent.change(searchInput, { target: { value: 'one' } })
      expect(screen.queryByText('field_two')).not.toBeInTheDocument()

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } })
      expect(screen.getByText('field_two')).toBeInTheDocument()
    })

    it('should show no results when search matches nothing', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      const searchInput = screen.getByRole('textbox')
      fireEvent.change(searchInput, { target: { value: 'xyz' } })

      expect(screen.queryByText('field_one')).not.toBeInTheDocument()
      expect(screen.queryByText('field_two')).not.toBeInTheDocument()
      expect(screen.queryByText('field_three')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect with item data when item is clicked', () => {
      const handleSelect = vi.fn()
      render(
        <SelectMetadata
          list={mockList}
          onSelect={handleSelect}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('field_one'))

      expect(handleSelect).toHaveBeenCalledWith({
        id: '1',
        name: 'field_one',
        type: DataType.string,
      })
    })

    it('should call onNew when new button is clicked', () => {
      const handleNew = vi.fn()
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={handleNew}
          onManage={vi.fn()}
        />,
      )

      // Find and click the new action button
      const newButton = screen.getByText(/new/i)
      fireEvent.click(newButton.closest('div') || newButton)

      expect(handleNew).toHaveBeenCalled()
    })

    it('should call onManage when manage button is clicked', () => {
      const handleManage = vi.fn()
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={handleManage}
        />,
      )

      // Find and click the manage action button
      const manageButton = screen.getByText(/manage/i)
      fireEvent.click(manageButton.closest('div') || manageButton)

      expect(handleManage).toHaveBeenCalled()
    })
  })

  describe('Empty State', () => {
    it('should render empty list', () => {
      const { container } = render(
        <SelectMetadata
          list={[]}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should still show new and manage buttons with empty list', () => {
      render(
        <SelectMetadata
          list={[]}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByText(/new/i)).toBeInTheDocument()
      expect(screen.getByText(/manage/i)).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should have correct container styling', () => {
      const { container } = render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(container.firstChild).toHaveClass('w-[320px]', 'rounded-xl')
    })
  })

  describe('Edge Cases', () => {
    it('should handle single item list', () => {
      const singleItem: MetadataItem[] = [
        { id: '1', name: 'only_one', type: DataType.string },
      ]
      render(
        <SelectMetadata
          list={singleItem}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByText('only_one')).toBeInTheDocument()
    })

    it('should handle item with long name', () => {
      const longNameItem: MetadataItem[] = [
        { id: '1', name: 'this_is_a_very_long_field_name_that_might_overflow', type: DataType.string },
      ]
      render(
        <SelectMetadata
          list={longNameItem}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )
      expect(screen.getByText('this_is_a_very_long_field_name_that_might_overflow')).toBeInTheDocument()
    })

    it('should handle rapid search input changes', () => {
      render(
        <SelectMetadata
          list={mockList}
          onSelect={vi.fn()}
          onNew={vi.fn()}
          onManage={vi.fn()}
        />,
      )

      const searchInput = screen.getByRole('textbox')

      // Rapid typing
      fireEvent.change(searchInput, { target: { value: 'f' } })
      fireEvent.change(searchInput, { target: { value: 'fi' } })
      fireEvent.change(searchInput, { target: { value: 'fie' } })
      fireEvent.change(searchInput, { target: { value: 'fiel' } })
      fireEvent.change(searchInput, { target: { value: 'field' } })

      expect(screen.getByText('field_one')).toBeInTheDocument()
      expect(screen.getByText('field_two')).toBeInTheDocument()
      expect(screen.getByText('field_three')).toBeInTheDocument()
    })
  })
})
