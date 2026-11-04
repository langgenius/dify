import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowVersionFilterOptions } from '../../../../types'
import FilterItem from '../filter-item'

describe('FilterItem', () => {
  it('maps the selected option to its workflow filter key', async () => {
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

    await user.click(option)

    expect(onClick).toHaveBeenCalledWith(WorkflowVersionFilterOptions.onlyYours)
  })
})
