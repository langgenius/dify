import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowOnboardingModal from '../index'

describe('WorkflowOnboardingModal', () => {
  it('selects a user input start node', async () => {
    const user = userEvent.setup()
    const onSelectStartNode = vi.fn()
    const props = { onClose: vi.fn(), onSelectStartNode }
    const { rerender } = render(<WorkflowOnboardingModal {...props} isShow={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<WorkflowOnboardingModal {...props} isShow />)

    await user.click(screen.getByRole('button', { name: /workflow.onboarding.userInputFull/ }))

    expect(onSelectStartNode).toHaveBeenCalledWith(BlockEnum.Start)
  })
  it('closes from the dialog control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<WorkflowOnboardingModal isShow onClose={onClose} onSelectStartNode={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
