import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowKindChangeDialog } from '../built-in-publisher/workflow-kind-change-dialog'

describe('WorkflowKindChangeDialog', () => {
  it('stays closed without a target kind', () => {
    render(<WorkflowKindChangeDialog targetKind={null} onCancel={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each([
    { targetKind: 'evaluation' as const, title: /^workflow\.common\.switchToEvaluationWorkflow$/ },
    { targetKind: 'standard' as const, title: /^workflow\.common\.switchToStandardWorkflow$/ },
  ])('confirms switching to a $targetKind workflow', async ({ targetKind, title }) => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <WorkflowKindChangeDialog targetKind={targetKind} onCancel={vi.fn()} onConfirm={onConfirm} />,
    )

    const dialog = screen.getByRole('alertdialog', { name: title })
    await user.click(within(dialog).getByRole('button', { name: /operation\.confirm/ }))

    expect(onConfirm).toHaveBeenCalledWith(targetKind)
  })

  it('cancels without switching', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(
      <WorkflowKindChangeDialog
        targetKind="evaluation"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /operation\.cancel/ }),
    )

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
