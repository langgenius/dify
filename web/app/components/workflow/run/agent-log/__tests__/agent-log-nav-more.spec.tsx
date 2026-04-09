import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentLogNavMore from '../agent-log-nav-more'

const createLogItem = (overrides: Partial<AgentLogItemWithChildren> = {}): AgentLogItemWithChildren => ({
  message_id: 'message-1',
  label: 'Planner',
  children: [],
  status: 'succeeded',
  node_execution_id: 'exec-1',
  node_id: 'node-1',
  data: {},
  ...overrides,
})

describe('AgentLogNavMore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nested options in the real menu and routes selection clicks', async () => {
    const user = userEvent.setup()
    const onShowAgentOrToolLog = vi.fn()
    const option = createLogItem({ message_id: 'mid', label: 'Intermediate Tool' })

    render(
      <AgentLogNavMore
        options={[option]}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Intermediate Tool'))

    expect(onShowAgentOrToolLog).toHaveBeenCalledWith(option)
  })
})
