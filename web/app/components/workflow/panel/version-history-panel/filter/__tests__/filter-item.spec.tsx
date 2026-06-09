import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowVersionFilterOptions } from '../../../../types'
import FilterItem from '../filter-item'

describe('FilterItem', () => {
  it('renders the label, fires selection, and shows the check mark when selected', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { container } = render(
      <FilterItem
        item={{
          key: WorkflowVersionFilterOptions.onlyYours,
          name: 'Only yours',
        }}
        isSelected
        onClick={onClick}
      />,
    )

    await user.click(screen.getByText('Only yours'))

    expect(onClick).toHaveBeenCalledWith(WorkflowVersionFilterOptions.onlyYours)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
