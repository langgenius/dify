import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmAddVar from '../index'

describe('ConfirmAddVar', () => {
  it.each(['add', 'cancel'])('shows the proposed variables before choosing %s', async (action) => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmAddVar
        varNameArr={['foo', 'bar']}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onHide={vi.fn()}
      />,
    )
    const confirmation = screen.getByRole('group', { name: 'appDebug.autoAddVar' })
    expect(within(confirmation).getByText('foo')).toBeInTheDocument()
    expect(within(confirmation).getByText('bar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
    expect(action === 'add' ? onConfirm : onCancel).toHaveBeenCalledOnce()
    expect(action === 'add' ? onCancel : onConfirm).not.toHaveBeenCalled()
  })
})
