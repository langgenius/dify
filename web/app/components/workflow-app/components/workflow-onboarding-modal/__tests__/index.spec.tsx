import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowOnboardingModal from '../index'

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({
    open,
    onSelect,
    trigger,
  }: {
    open?: boolean
    onSelect: (type: BlockEnum, config?: Record<string, unknown>) => void
    trigger?: ((open: boolean) => ReactNode) | ReactNode
  }) => (
    <div>
      {typeof trigger === 'function' ? trigger(Boolean(open)) : trigger}
      {open && (
        <button
          type="button"
          onClick={() => onSelect(BlockEnum.TriggerWebhook, { config: 'test' })}
        >
          Select Trigger Webhook
        </button>
      )}
    </div>
  ),
}))

describe('WorkflowOnboardingModal', () => {
  it('only renders while onboarding is open', () => {
    const props = { onClose: vi.fn(), onSelectStartNode: vi.fn() }
    const { rerender } = render(<WorkflowOnboardingModal {...props} isShow={false} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<WorkflowOnboardingModal {...props} isShow />)
    expect(screen.getByRole('dialog', { name: 'workflow.onboarding.title' })).toBeInTheDocument()
  })

  it('selects a user input start node', async () => {
    const user = userEvent.setup()
    const onSelectStartNode = vi.fn()
    render(
      <WorkflowOnboardingModal isShow onClose={vi.fn()} onSelectStartNode={onSelectStartNode} />,
    )

    await user.click(screen.getByText('workflow.onboarding.userInputFull'))

    expect(onSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
  })

  it('forwards trigger configuration', async () => {
    const user = userEvent.setup()
    const onSelectStartNode = vi.fn()
    render(
      <WorkflowOnboardingModal isShow onClose={vi.fn()} onSelectStartNode={onSelectStartNode} />,
    )

    await user.click(screen.getByText('workflow.onboarding.trigger'))
    await user.click(screen.getByRole('button', { name: 'Select Trigger Webhook' }))

    expect(onSelectStartNode).toHaveBeenCalledWith(BlockEnum.TriggerWebhook, { config: 'test' })
  })

  it('closes from the dialog control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<WorkflowOnboardingModal isShow onClose={onClose} onSelectStartNode={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
