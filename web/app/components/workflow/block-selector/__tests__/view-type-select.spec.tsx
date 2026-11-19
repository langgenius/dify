import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewType } from '../types'
import ViewTypeSelect from '../view-type-select'

it('maps the tree view action to the workflow view type', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<ViewTypeSelect viewType={ViewType.flat} onChange={onChange} />)
  await user.click(screen.getByRole('radio', { name: 'workflow.tabs.treeView' }))
  expect(onChange).toHaveBeenCalledWith(ViewType.tree)
})
