import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import Sort from './index'

const mockItems = [
  { value: 'created_at', name: 'Date Created' },
  { value: 'name', name: 'Name' },
  { value: 'status', name: 'Status' },
]

describe('Sort component — real portal integration', () => {
  const setup = (props = {}) => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const { container, rerender } = render(
      <Sort value="created_at" items={mockItems} onSelect={onSelect} order="" {...props} />,
    )

    // helper: returns a non-null HTMLElement or throws with a clear message
    const getTriggerWrapper = (): HTMLElement => {
      const labelNode = screen.getByText('appLog.filter.sortBy')
      // try to find a reasonable wrapper element; prefer '.block' but fallback to any ancestor div
      const wrapper = labelNode.closest('.block') ?? labelNode.closest('div')
      if (!wrapper)
        throw new Error('Trigger wrapper element not found for "Sort by" label')
      return wrapper as HTMLElement
    }

    // helper: returns right-side sort button element
    const getSortButton = (): HTMLElement => {
      const btn = container.querySelector('.rounded-r-lg')
      if (!btn)
        throw new Error('Sort button (rounded-r-lg) not found in rendered container')
      return btn as HTMLElement
    }

    return { user, onSelect, rerender, getTriggerWrapper, getSortButton }
  }

  it('renders and shows selected item label and sort icon', () => {
    const { getSortButton } = setup({ order: '' })

    expect(screen.getByText('Date Created')).toBeInTheDocument()

    const sortButton = getSortButton()
    expect(sortButton).toBeInstanceOf(HTMLElement)
    expect(sortButton.querySelector('svg')).toBeInTheDocument()
  })

  it('opens and closes the tooltip (portal mounts to document.body)', async () => {
    const { user, getTriggerWrapper } = setup()

    await user.click(getTriggerWrapper())
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(document.body.contains(tooltip)).toBe(true)

    // clicking the trigger again should close it
    await user.click(getTriggerWrapper())
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('renders options and calls onSelect with descending prefix when order is "-"', async () => {
    const { user, onSelect, getTriggerWrapper } = setup({ order: '-' })

    await user.click(getTriggerWrapper())
    const tooltip = await screen.findByRole('tooltip')

    mockItems.forEach((item) => {
      expect(within(tooltip).getByText(item.name)).toBeInTheDocument()
    })

    await user.click(within(tooltip).getByText('Name'))
    expect(onSelect).toHaveBeenCalledWith('-name')
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('toggles sorting order: ascending -> descending via right-side button', async () => {
    const { user, onSelect, getSortButton } = setup({ order: '', value: 'created_at' })
    await user.click(getSortButton())
    expect(onSelect).toHaveBeenCalledWith('-created_at')
  })

  it('toggles sorting order: descending -> ascending via right-side button', async () => {
    const { user, onSelect, getSortButton } = setup({ order: '-', value: 'name' })
    await user.click(getSortButton())
    expect(onSelect).toHaveBeenCalledWith('name')
  })

  it('shows checkmark only for selected item in menu', async () => {
    const { user, getTriggerWrapper } = setup({ value: 'status' })

    await user.click(getTriggerWrapper())
    const tooltip = await screen.findByRole('tooltip')

    const statusRow = within(tooltip).getByText('Status').closest('.flex')
    const nameRow = within(tooltip).getByText('Name').closest('.flex')

    if (!statusRow)
      throw new Error('Status option row not found in menu')
    if (!nameRow)
      throw new Error('Name option row not found in menu')

    expect(statusRow.querySelector('svg')).toBeInTheDocument()
    expect(nameRow.querySelector('svg')).not.toBeInTheDocument()
  })

  it('shows empty selection label when value is unknown', () => {
    setup({ value: 'unknown_value' })
    const label = screen.getByText('appLog.filter.sortBy')
    const valueNode = label.nextSibling
    if (!valueNode)
      throw new Error('Expected a sibling node for the selection text')
    expect(String(valueNode.textContent || '').trim()).toBe('')
  })

  it('handles undefined order prop without asserting a literal "undefined" prefix', async () => {
    const { user, onSelect, getTriggerWrapper } = setup({ order: undefined })

    await user.click(getTriggerWrapper())
    const tooltip = await screen.findByRole('tooltip')

    await user.click(within(tooltip).getByText('Name'))

    expect(onSelect).toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/name$/))
  })

  it('clicking outside the open menu closes the portal', async () => {
    const { user, getTriggerWrapper } = setup()
    await user.click(getTriggerWrapper())
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toBeInTheDocument()

    // click outside: body click should close the tooltip
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })
})
