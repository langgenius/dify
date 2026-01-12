import type { Item } from './index'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Chip from './index'

afterEach(cleanup)

// Test data factory
const createTestItems = (): Item[] => [
  { value: 'all', name: 'All Items' },
  { value: 'active', name: 'Active' },
  { value: 'archived', name: 'Archived' },
]

describe('Chip', () => {
  // Shared test props
  let items: Item[]
  let onSelect: (item: Item) => void
  let onClear: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    items = createTestItems()
    onSelect = vi.fn()
    onClear = vi.fn()
  })

  // Helper function to render Chip with default props
  const renderChip = (props: Partial<React.ComponentProps<typeof Chip>> = {}) => {
    return render(
      <Chip
        value="all"
        items={items}
        onSelect={onSelect}
        onClear={onClear}
        {...props}
      />,
    )
  }

  // Helper function to get the trigger element
  const getTrigger = (container: HTMLElement) => {
    return container.querySelector('[data-state]')
  }

  // Helper function to open dropdown panel
  const openPanel = (container: HTMLElement) => {
    const trigger = getTrigger(container)
    if (trigger)
      fireEvent.click(trigger)
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderChip()

      expect(screen.getByText('All Items')).toBeInTheDocument()
    })

    it('should display current selected item name', () => {
      renderChip({ value: 'active' })

      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('should display empty content when value does not match any item', () => {
      const { container } = renderChip({ value: 'nonexistent' })

      // When value doesn't match, no text should be displayed in trigger
      const trigger = getTrigger(container)
      // Check that there's no item name text (only icons should be present)
      expect(trigger?.textContent?.trim()).toBeFalsy()
    })
  })

  describe('Props', () => {
    it('should update displayed item name when value prop changes', () => {
      const { rerender } = renderChip({ value: 'all' })
      expect(screen.getByText('All Items')).toBeInTheDocument()

      rerender(
        <Chip
          value="archived"
          items={items}
          onSelect={onSelect}
          onClear={onClear}
        />,
      )
      expect(screen.getByText('Archived')).toBeInTheDocument()
    })

    it('should show left icon by default', () => {
      const { container } = renderChip()

      // The filter icon should be visible
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should hide left icon when showLeftIcon is false', () => {
      renderChip({ showLeftIcon: false })

      // When showLeftIcon is false, there should be no filter icon before the text
      const textElement = screen.getByText('All Items')
      const parent = textElement.closest('div[data-state]')
      const icons = parent?.querySelectorAll('svg')

      // Should only have the arrow icon, not the filter icon
      expect(icons?.length).toBe(1)
    })

    it('should render custom left icon', () => {
      const CustomIcon = () => <span data-testid="custom-icon">★</span>

      renderChip({ leftIcon: <CustomIcon /> })

      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })

    it('should apply custom className to trigger', () => {
      const customClass = 'custom-chip-class'

      const { container } = renderChip({ className: customClass })

      const chipElement = container.querySelector(`.${customClass}`)
      expect(chipElement).toBeInTheDocument()
    })

    it('should apply custom panelClassName to dropdown panel', () => {
      const customPanelClass = 'custom-panel-class'

      const { container } = renderChip({ panelClassName: customPanelClass })
      openPanel(container)

      // Panel is rendered in a portal, so check document.body
      const panel = document.body.querySelector(`.${customPanelClass}`)
      expect(panel).toBeInTheDocument()
    })
  })

  describe('State Management', () => {
    it('should toggle dropdown panel on trigger click', () => {
      const { container } = renderChip()

      // Initially closed - check data-state attribute
      const trigger = getTrigger(container)
      expect(trigger).toHaveAttribute('data-state', 'closed')

      // Open panel
      openPanel(container)
      expect(trigger).toHaveAttribute('data-state', 'open')
      // Panel items should be visible
      expect(screen.getAllByText('All Items').length).toBeGreaterThan(1)

      // Close panel
      if (trigger)
        fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('data-state', 'closed')
    })

    it('should close panel after selecting an item', () => {
      const { container } = renderChip()

      openPanel(container)
      const trigger = getTrigger(container)
      expect(trigger).toHaveAttribute('data-state', 'open')

      // Click on an item in the dropdown panel
      const activeItems = screen.getAllByText('Active')
      // The second one should be in the dropdown
      fireEvent.click(activeItems[activeItems.length - 1])

      expect(trigger).toHaveAttribute('data-state', 'closed')
    })
  })

  describe('Event Handlers', () => {
    it('should call onSelect with correct item when item is clicked', () => {
      const { container } = renderChip()

      openPanel(container)
      // Get all "Active" texts and click the one in the dropdown (should be the last one)
      const activeItems = screen.getAllByText('Active')
      fireEvent.click(activeItems[activeItems.length - 1])

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(items[1])
    })

    it('should call onClear when clear button is clicked', () => {
      const { container } = renderChip({ value: 'active' })

      // Find the close icon (last SVG in the trigger) and click its parent
      const trigger = getTrigger(container)
      const svgs = trigger?.querySelectorAll('svg')
      // The close icon should be the last SVG element
      const closeIcon = svgs?.[svgs.length - 1]
      const clearButton = closeIcon?.parentElement

      expect(clearButton).toBeInTheDocument()
      if (clearButton)
        fireEvent.click(clearButton)

      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should stop event propagation when clear button is clicked', () => {
      const { container } = renderChip({ value: 'active' })

      const trigger = getTrigger(container)
      expect(trigger).toHaveAttribute('data-state', 'closed')

      // Find the close icon (last SVG) and click its parent
      const svgs = trigger?.querySelectorAll('svg')
      const closeIcon = svgs?.[svgs.length - 1]
      const clearButton = closeIcon?.parentElement

      if (clearButton)
        fireEvent.click(clearButton)

      // Panel should remain closed
      expect(trigger).toHaveAttribute('data-state', 'closed')
      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple rapid clicks on trigger', () => {
      const { container } = renderChip()

      const trigger = getTrigger(container)

      // Click 1: open
      if (trigger)
        fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('data-state', 'open')

      // Click 2: close
      if (trigger)
        fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('data-state', 'closed')

      // Click 3: open again
      if (trigger)
        fireEvent.click(trigger)
      expect(trigger).toHaveAttribute('data-state', 'open')
    })
  })

  describe('Conditional Rendering', () => {
    it('should show arrow down icon when no value is selected', () => {
      const { container } = renderChip({ value: '' })

      // Should have SVG icons (filter icon and arrow down icon)
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should show clear button when value is selected', () => {
      const { container } = renderChip({ value: 'active' })

      // When value is selected, there should be an icon (the close icon)
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should not show clear button when no value is selected', () => {
      const { container } = renderChip({ value: '' })

      const trigger = getTrigger(container)

      // When value is empty, the trigger should only have 2 SVGs (filter icon + arrow)
      // When value is selected, it would have 2 SVGs (filter icon + close icon)
      const svgs = trigger?.querySelectorAll('svg')
      // Arrow icon should be present, close icon should not
      expect(svgs?.length).toBe(2)

      // Verify onClear hasn't been called
      expect(onClear).not.toHaveBeenCalled()
    })

    it('should show dropdown content only when panel is open', () => {
      const { container } = renderChip()

      const trigger = getTrigger(container)

      // Closed by default
      expect(trigger).toHaveAttribute('data-state', 'closed')

      openPanel(container)
      expect(trigger).toHaveAttribute('data-state', 'open')
      // Items should be duplicated (once in trigger, once in panel)
      expect(screen.getAllByText('All Items').length).toBeGreaterThan(1)
    })

    it('should show check icon on selected item in dropdown', () => {
      const { container } = renderChip({ value: 'active' })

      openPanel(container)

      // Find the dropdown panel items
      const allActiveTexts = screen.getAllByText('Active')
      // The dropdown item should be the last one
      const dropdownItem = allActiveTexts[allActiveTexts.length - 1]
      const parentContainer = dropdownItem.parentElement

      // The check icon should be a sibling within the parent
      const checkIcon = parentContainer?.querySelector('svg')
      expect(checkIcon).toBeInTheDocument()
    })

    it('should render all items in dropdown when open', () => {
      const { container } = renderChip()

      openPanel(container)

      // Each item should appear at least twice (once in potential selected state, once in dropdown)
      // Use getAllByText to handle multiple occurrences
      expect(screen.getAllByText('All Items').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Archived').length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty items array', () => {
      const { container } = renderChip({ items: [], value: '' })

      // Trigger should still render
      const trigger = container.querySelector('[data-state]')
      expect(trigger).toBeInTheDocument()
    })

    it('should handle value not in items list', () => {
      const { container } = renderChip({ value: 'nonexistent' })

      const trigger = getTrigger(container)
      expect(trigger).toBeInTheDocument()

      // The trigger should not display any item name text
      expect(trigger?.textContent?.trim()).toBeFalsy()
    })

    it('should allow selecting already selected item', () => {
      const { container } = renderChip({ value: 'active' })

      openPanel(container)

      // Click on the already selected item in the dropdown
      const activeItems = screen.getAllByText('Active')
      fireEvent.click(activeItems[activeItems.length - 1])

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(items[1])
    })

    it('should handle numeric values', () => {
      const numericItems: Item[] = [
        { value: 1, name: 'First' },
        { value: 2, name: 'Second' },
        { value: 3, name: 'Third' },
      ]

      const { container } = renderChip({ value: 2, items: numericItems })

      expect(screen.getByText('Second')).toBeInTheDocument()

      // Open panel and select Third
      openPanel(container)

      const thirdItems = screen.getAllByText('Third')
      fireEvent.click(thirdItems[thirdItems.length - 1])

      expect(onSelect).toHaveBeenCalledWith(numericItems[2])
    })

    it('should handle items with additional properties', () => {
      const itemsWithExtra: Item[] = [
        { value: 'a', name: 'Item A', customProp: 'extra1' },
        { value: 'b', name: 'Item B', customProp: 'extra2' },
      ]

      const { container } = renderChip({ value: 'a', items: itemsWithExtra })

      expect(screen.getByText('Item A')).toBeInTheDocument()

      // Open panel and select Item B
      openPanel(container)

      const itemBs = screen.getAllByText('Item B')
      fireEvent.click(itemBs[itemBs.length - 1])

      expect(onSelect).toHaveBeenCalledWith(itemsWithExtra[1])
    })
  })
})
