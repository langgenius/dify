import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OperationDropdown from '../operation-dropdown'

it.each(['edit', 'remove'])('dispatches only %s and closes the menu', async (action) => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onRemove = vi.fn()
  render(<OperationDropdown onEdit={onEdit} onRemove={onRemove} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  await user.click(screen.getByRole('menuitem', { name: `tools.mcp.operation.${action}` }))
  expect(action === 'edit' ? onEdit : onRemove).toHaveBeenCalledOnce()
  expect(action === 'edit' ? onRemove : onEdit).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
})
