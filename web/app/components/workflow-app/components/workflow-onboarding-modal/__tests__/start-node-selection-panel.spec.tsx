import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeSelectionPanel from '../start-node-selection-panel'

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({
    open,
    onOpenChange,
    onSelect,
    trigger,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (type: BlockEnum) => void
    trigger: (() => ReactNode) | ReactNode
  }) => (
    <div>
      {typeof trigger === 'function' ? trigger() : trigger}
      {open && (
        <div>
          <button type="button" onClick={() => onSelect(BlockEnum.TriggerSchedule)}>
            Select Schedule
          </button>
          <button type="button" onClick={() => onOpenChange(false)}>
            Close selector
          </button>
        </div>
      )}
    </div>
  ),
}))

describe('StartNodeSelectionPanel', () => {
  it('selects a user input start node', async () => {
    const user = userEvent.setup()
    const onSelectUserInput = vi.fn()
    render(
      <StartNodeSelectionPanel onSelectUserInput={onSelectUserInput} onSelectTrigger={vi.fn()} />,
    )

    await user.click(screen.getByText('workflow.onboarding.userInputFull'))

    expect(onSelectUserInput).toHaveBeenCalledTimes(1)
  })

  it('selects a trigger start node and closes the selector', async () => {
    const user = userEvent.setup()
    const onSelectTrigger = vi.fn()
    render(
      <StartNodeSelectionPanel onSelectUserInput={vi.fn()} onSelectTrigger={onSelectTrigger} />,
    )

    await user.click(screen.getByText('workflow.onboarding.trigger'))
    await user.click(screen.getByRole('button', { name: 'Select Schedule' }))

    expect(onSelectTrigger).toHaveBeenCalledWith(BlockEnum.TriggerSchedule, undefined)
    expect(screen.queryByRole('button', { name: 'Select Schedule' })).not.toBeInTheDocument()
  })

  it('closes the trigger selector without selecting a node', async () => {
    const user = userEvent.setup()
    const onSelectTrigger = vi.fn()
    render(
      <StartNodeSelectionPanel onSelectUserInput={vi.fn()} onSelectTrigger={onSelectTrigger} />,
    )

    await user.click(screen.getByText('workflow.onboarding.trigger'))
    await user.click(screen.getByRole('button', { name: 'Close selector' }))

    expect(onSelectTrigger).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Select Schedule' })).not.toBeInTheDocument()
  })
})
