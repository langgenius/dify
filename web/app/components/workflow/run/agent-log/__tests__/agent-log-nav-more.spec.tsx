import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentLogNavMore from '../agent-log-nav-more'

const createLogItem = (
  overrides: Partial<AgentLogItemWithChildren> = {},
): AgentLogItemWithChildren => ({
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

    render(<AgentLogNavMore options={[option]} onShowAgentOrToolLog={onShowAgentOrToolLog} />)

    const menuButton = screen.getByRole('button', {
      name: 'common.operation.more',
      expanded: false,
    })
    await user.click(menuButton)
    expect(
      screen.getByRole('button', { name: 'common.operation.more', expanded: true }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Intermediate Tool' }))

    expect(onShowAgentOrToolLog).toHaveBeenCalledWith(option)
  })
})
