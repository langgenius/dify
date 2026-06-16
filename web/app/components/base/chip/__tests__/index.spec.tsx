import type { Item } from '../index'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import Chip from '../index'

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
    const user = userEvent.setup()
    return {
      user,
      ...render(
        <Chip
          value="all"
          items={items}
          onSelect={onSelect}
          onClear={onClear}
          {...props}
        />,
      ),
    }
  }

  // Helper function to get the trigger element
  const getTrigger = (container: HTMLElement) => {
    return container.querySelector('button[role="combobox"]') as HTMLElement | null
  }

  // Helper function to open dropdown panel
  const openPanel = async (user: ReturnType<typeof userEvent.setup>, container: HTMLElement) => {
    const trigger = getTrigger(container)
    expect(trigger).toBeInTheDocument()
    await user.click(trigger!)
    return screen.findByRole('listbox')
  }

  const expectPanelClosed = async (trigger: HTMLElement | null) => {
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(trigger).not.toHaveAttribute('data-popup-open')
    })
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderChip()

      expect(screen.getByText('All Items'))!.toBeInTheDocument()
    })

    it('should display current selected item name', () => {
      renderChip({ value: 'active' })

      expect(screen.getByRole('combobox', { name: 'Active' }))!.toBeInTheDocument()
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
      expect(screen.getByText('All Items'))!.toBeInTheDocument()

      rerender(
        <Chip
          value="archived"
          items={items}
          onSelect={onSelect}
          onClear={onClear}
        />,
      )
      expect(screen.getByRole('combobox', { name: 'Archived' }))!.toBeInTheDocument()
    })

    it('should use triggerName only for the closed trigger label', async () => {
      const { container, user } = renderChip({
        items: [
          { value: 'all', name: 'All Items', triggerName: 'Item Types' },
          { value: 'active', name: 'Active' },
        ],
        value: 'all',
      })

      expect(screen.getByRole('combobox', { name: 'Item Types' }))!.toBeInTheDocument()

      await openPanel(user, container)

      expect(await screen.findByRole('option', { name: 'All Items' }))!.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Item Types' })).not.toBeInTheDocument()
    })

    it('should show left icon by default', () => {
      const { container } = renderChip()

      expect(container.querySelector('.i-ri-filter-3-line')).toBeInTheDocument()
    })

    it('should hide left icon when showLeftIcon is false', () => {
      renderChip({ showLeftIcon: false, value: '' })

      // When showLeftIcon is false, there should be no filter icon before the text
      const trigger = getTrigger(document.body)
      expect(trigger?.querySelector('.i-ri-filter-3-line')).not.toBeInTheDocument()
      expect(trigger?.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })

    it('should render custom left icon', () => {
      const CustomIcon = () => <span data-testid="custom-icon">★</span>

      renderChip({ leftIcon: <CustomIcon /> })

      expect(screen.getByTestId('custom-icon'))!.toBeInTheDocument()
    })

    it('should apply custom className to trigger', () => {
      const customClass = 'custom-chip-class'

      const { container } = renderChip({ className: customClass })

      const chipElement = container.querySelector(`.${customClass}`)
      expect(chipElement)!.toBeInTheDocument()
    })

    it('should apply custom panelClassName to dropdown panel', async () => {
      const customPanelClass = 'custom-panel-class'

      const { container, user } = renderChip({ panelClassName: customPanelClass })
      await openPanel(user, container)

      // Panel is rendered in a portal, so check document.body
      const panel = document.body.querySelector(`.${customPanelClass}`)
      expect(panel)!.toBeInTheDocument()
    })
  })

  describe('State Management', () => {
    it('should toggle dropdown panel on trigger click', async () => {
      const { container, user } = renderChip()

      const trigger = getTrigger(container)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(trigger).not.toHaveAttribute('data-popup-open')

      const listbox = await openPanel(user, container)
      expect(trigger).toHaveAttribute('data-popup-open')
      expect(within(listbox).getByRole('option', { name: 'All Items' })).toBeInTheDocument()

      if (trigger)
        await user.click(trigger)
      await expectPanelClosed(trigger)
    })

    it('should close panel after selecting an item', async () => {
      const { container, user } = renderChip()

      const listbox = await openPanel(user, container)
      const trigger = getTrigger(container)
      expect(trigger).toHaveAttribute('data-popup-open')

      await user.click(within(listbox).getByRole('option', { name: 'Active' }))

      await expectPanelClosed(trigger)
    })
  })

  describe('Event Handlers', () => {
    it('should call onSelect with correct item when item is clicked', async () => {
      const { container, user } = renderChip()

      const listbox = await openPanel(user, container)
      await user.click(within(listbox).getByRole('option', { name: 'Active' }))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(items[1])
    })

    it('should call onClear when clear button is clicked', async () => {
      const { user } = renderChip({ value: 'active' })

      const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })

      await user.click(clearButton)

      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should stop event propagation when clear button is clicked', async () => {
      const { container, user } = renderChip({ value: 'active' })

      const trigger = getTrigger(container)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(trigger).not.toHaveAttribute('data-popup-open')

      const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })

      await user.click(clearButton)

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(trigger).not.toHaveAttribute('data-popup-open')
      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple rapid clicks on trigger', async () => {
      const { container, user } = renderChip()

      const trigger = getTrigger(container)

      if (trigger)
        await user.click(trigger)
      expect(await screen.findByRole('listbox')).toBeInTheDocument()
      expect(trigger).toHaveAttribute('data-popup-open')

      if (trigger)
        await user.click(trigger)
      await expectPanelClosed(trigger)

      if (trigger)
        await user.click(trigger)
      expect(await screen.findByRole('listbox')).toBeInTheDocument()
      expect(trigger).toHaveAttribute('data-popup-open')
    })
  })

  describe('Conditional Rendering', () => {
    it('should show arrow down icon when no value is selected', () => {
      const { container } = renderChip({ value: '' })

      expect(container.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })

    it('should show clear button when value is selected', () => {
      const { container } = renderChip({ value: 'active' })

      expect(container.querySelector('.i-ri-close-circle-fill')).toBeInTheDocument()
    })

    it('should not show clear button when no value is selected', () => {
      const { container } = renderChip({ value: '' })

      const trigger = getTrigger(container)

      expect(trigger?.querySelector('.i-ri-filter-3-line')).toBeInTheDocument()
      expect(trigger?.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
      expect(container.querySelector('.i-ri-close-circle-fill')).not.toBeInTheDocument()

      // Verify onClear hasn't been called
      expect(onClear).not.toHaveBeenCalled()
    })

    it('should show dropdown content only when panel is open', async () => {
      const { container, user } = renderChip()

      const trigger = getTrigger(container)

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(trigger).not.toHaveAttribute('data-popup-open')

      const listbox = await openPanel(user, container)
      expect(trigger).toHaveAttribute('data-popup-open')
      expect(within(listbox).getByRole('option', { name: 'All Items' })).toBeInTheDocument()
    })

    it('should show check icon on selected item in dropdown', async () => {
      const { container, user } = renderChip({ value: 'active' })

      const listbox = await openPanel(user, container)

      expect(within(listbox).getByRole('option', { name: 'Active' })).toHaveAttribute('aria-selected', 'true')
    })

    it('should render all items in dropdown when open', async () => {
      const { container, user } = renderChip()

      const listbox = await openPanel(user, container)

      expect(within(listbox).getByRole('option', { name: 'All Items' })).toBeInTheDocument()
      expect(within(listbox).getByRole('option', { name: 'Active' })).toBeInTheDocument()
      expect(within(listbox).getByRole('option', { name: 'Archived' })).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty items array', () => {
      const { container } = renderChip({ items: [], value: '' })

      // Trigger should still render
      const trigger = getTrigger(container)
      expect(trigger)!.toBeInTheDocument()
    })

    it('should handle value not in items list', () => {
      const { container } = renderChip({ value: 'nonexistent' })

      const trigger = getTrigger(container)
      expect(trigger)!.toBeInTheDocument()

      // The trigger should not display any item name text
      expect(trigger?.textContent?.trim()).toBeFalsy()
      expect(screen.queryByRole('button', { name: 'common.operation.clear' })).not.toBeInTheDocument()
    })

    it('should allow selecting already selected item', async () => {
      const { container, user } = renderChip({ value: 'active' })

      const listbox = await openPanel(user, container)

      await user.click(within(listbox).getByRole('option', { name: 'Active' }))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(items[1])
    })

    it('should handle numeric values', async () => {
      const numericItems: Item[] = [
        { value: 1, name: 'First' },
        { value: 2, name: 'Second' },
        { value: 3, name: 'Third' },
      ]

      const { container, user } = renderChip({ value: 2, items: numericItems })

      expect(screen.getByText('Second'))!.toBeInTheDocument()

      // Open panel and select Third
      const listbox = await openPanel(user, container)

      await user.click(within(listbox).getByRole('option', { name: 'Third' }))

      expect(onSelect).toHaveBeenCalledWith(numericItems[2])
    })

    it('should treat numeric zero as a selected value', () => {
      const numericItems: Item[] = [
        { value: 0, name: 'Zero' },
        { value: 1, name: 'One' },
      ]

      renderChip({ value: 0, items: numericItems })

      expect(screen.getByRole('combobox', { name: 'Zero' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.clear' })).toBeInTheDocument()
    })

    it('should handle items with additional properties', async () => {
      const itemsWithExtra: Item[] = [
        { value: 'a', name: 'Item A', customProp: 'extra1' },
        { value: 'b', name: 'Item B', customProp: 'extra2' },
      ]

      const { container, user } = renderChip({ value: 'a', items: itemsWithExtra })

      expect(screen.getByText('Item A'))!.toBeInTheDocument()

      // Open panel and select Item B
      const listbox = await openPanel(user, container)

      await user.click(within(listbox).getByRole('option', { name: 'Item B' }))

      expect(onSelect).toHaveBeenCalledWith(itemsWithExtra[1])
    })
  })
})
