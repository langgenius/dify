import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowVersionFilterOptions } from '../../../../types'
import FilterItem from '../filter-item'

describe('FilterItem', () => {
  it('renders the label, fires selection, and shows the check mark when selected', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <FilterItem
        item={{
          key: WorkflowVersionFilterOptions.onlyYours,
          name: 'Only yours',
        }}
        isSelected
        onClick={onClick}
      />,
    )

    const option = screen.getByRole('button', { name: 'Only yours' })
    expect(option).toHaveAttribute('aria-pressed', 'true')

    option.focus()
    await user.keyboard(' ')

    expect(onClick).toHaveBeenCalledWith(WorkflowVersionFilterOptions.onlyYours)
  })
})
