import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentHeaderBar from '../agent-header-bar'

describe('AgentHeaderBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the agent tag with the default @ prefix and handle actions', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const onViewInternals = vi.fn()

    render(
      <AgentHeaderBar
        agentName="Research Agent"
        onRemove={onRemove}
        onViewInternals={onViewInternals}
      />,
    )

    expect(screen.getByText('@Research Agent')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.common.viewInternals' }))
    await user.click(screen.getAllByRole('button')[0])

    expect(onViewInternals).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('should hide the @ prefix for assemble mode and show the warning affordance', () => {
    render(
      <AgentHeaderBar
        agentName="Assemble variables"
        onRemove={vi.fn()}
        onViewInternals={vi.fn()}
        hasWarning
        showAtPrefix={false}
      />,
    )

    expect(screen.getByText('Assemble variables')).toBeInTheDocument()
    expect(screen.queryByText('@Assemble variables')).not.toBeInTheDocument()
  })
})
