import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RemoveEffectVarConfirm from '../remove-effect-var-confirm'

describe('RemoveEffectVarConfirm', () => {
  it('should call onConfirm when confirm is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<RemoveEffectVarConfirm isShow onConfirm={onConfirm} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(<RemoveEffectVarConfirm isShow onConfirm={vi.fn()} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
