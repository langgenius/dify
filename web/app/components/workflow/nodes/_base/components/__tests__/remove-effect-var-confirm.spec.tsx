import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RemoveEffectVarConfirm from '../remove-effect-var-confirm'

describe('RemoveEffectVarConfirm', () => {
  it('should render title and content when open', () => {
    render(
      <RemoveEffectVarConfirm
        isShow
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.effectVarConfirm.title')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.effectVarConfirm.content')).toBeInTheDocument()
  })

  it('should call onConfirm when confirm is clicked', () => {
    const onConfirm = vi.fn()

    render(
      <RemoveEffectVarConfirm
        isShow
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()

    render(
      <RemoveEffectVarConfirm
        isShow
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
