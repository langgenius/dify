import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StartNodeSelectionPanel from '../start-node-selection-panel'

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
})
