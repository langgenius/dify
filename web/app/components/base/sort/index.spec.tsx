import type { Item } from './index'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Sort from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'filter.sortBy' ? 'Sort by' : key),
  }),
}))

const mockItems: Item[] = [
  { value: 'created_at', name: 'Date Created' },
  { value: 'name', name: 'Name' },
  { value: 'status', name: 'Status' },
]

describe('Sort Component', () => {
  const setup = (props = {}) => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { container, rerender } = render(
      <Sort
        value="created_at"
        items={mockItems}
        onSelect={onSelect}
        order=""
        {...props}
      />,
    )

    // Helper functions to get fresh elements (avoids stale closures)
    const getTriggerWrapper = () => screen.getByText('Sort by').closest('.block') as HTMLElement
    const getTriggerContainer = () => getTriggerWrapper().firstChild as HTMLElement
    const getSortButton = () => container.querySelector('.rounded-r-lg') as HTMLElement

    return {
      user,
      onSelect,
      getTriggerWrapper,
      getTriggerContainer,
      getSortButton,
      rerender,
    }
  }

  it('renders the initial state with correct label and sort icon', () => {
    const { getTriggerContainer, getSortButton } = setup({ order: '' })

    expect(screen.getByText('Date Created')).toBeInTheDocument()

    expect(getTriggerContainer()).toHaveClass('bg-components-input-bg-normal')

    expect(getSortButton().querySelector('svg')).toBeInTheDocument()
  })

  it('toggles the dropdown visibility when trigger is clicked', async () => {
    const { user, getTriggerWrapper, getTriggerContainer } = setup()

    await user.click(getTriggerWrapper())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    expect(getTriggerContainer()).toHaveClass('!bg-state-base-hover-alt')

    await user.click(getTriggerWrapper())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders all options and allows selection', async () => {
    const { user, onSelect, getTriggerWrapper } = setup({ order: '-' })

    await user.click(getTriggerWrapper())
    const menu = screen.getByRole('tooltip')

    mockItems.forEach((item) => {
      expect(within(menu).getByText(item.name)).toBeInTheDocument()
    })

    await user.click(within(menu).getByText('Name'))

    expect(onSelect).toHaveBeenCalledWith('-name')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('handles sorting order toggle from Ascending to Descending', async () => {
    const { user, onSelect, getSortButton } = setup({ order: '', value: 'created_at' })

    await user.click(getSortButton())
    expect(onSelect).toHaveBeenCalledWith('-created_at')
  })

  it('handles sorting order toggle from Descending to Ascending', async () => {
    const { user, onSelect, getSortButton } = setup({ order: '-', value: 'name' })

    await user.click(getSortButton())
    expect(onSelect).toHaveBeenCalledWith('name')
  })

  it('displays the active checkmark only for the selected item', async () => {
    const { user, getTriggerWrapper } = setup({ value: 'status' })

    await user.click(getTriggerWrapper())
    const menu = screen.getByRole('tooltip')

    const statusOption = within(menu).getByText('Status').closest('.flex') as HTMLElement
    const nameOption = within(menu).getByText('Name').closest('.flex') as HTMLElement

    expect(statusOption.querySelector('svg')).toBeInTheDocument()
    expect(nameOption.querySelector('svg')).not.toBeInTheDocument()
  })

  it('handles edge case where value does not match any item', () => {
    setup({ value: 'unknown_value' })

    const valueDisplay = screen.getByText('Sort by').nextSibling
    expect(valueDisplay).toHaveTextContent('')
  })

  it('applies correct text styling based on value presence', () => {
    const { onSelect, rerender } = setup({ value: '' })

    const textElementNoValue = screen.getByText('Sort by').nextSibling as HTMLElement
    expect(textElementNoValue).toHaveClass('text-text-tertiary')

    // Case 2: Has value (Text should be secondary)
    rerender(
      <Sort
        value="created_at"
        items={mockItems}
        onSelect={onSelect}
        order=""
      />,
    )
    const textElementWithValue = screen.getByText('Date Created').closest('div')
    expect(textElementWithValue).toHaveClass('text-text-secondary')
  })

  it('handles undefined order prop gracefully', async () => {
    const { user, onSelect, getTriggerWrapper } = setup({ order: undefined })

    await user.click(getTriggerWrapper())
    const menu = screen.getByRole('tooltip')

    await user.click(within(menu).getByText('Name'))

    expect(onSelect).toHaveBeenCalledWith('undefinedname')
  })
})
