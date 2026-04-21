import type { AppContextValue } from '@/context/app-context'
import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AppContext,
  initialLangGeniusVersionInfo,
  initialWorkspaceInfo,
  userProfilePlaceholder,
} from '@/context/app-context'
import AgentResultPanel from '../agent-result-panel'

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

const createAppContextValue = (): AppContextValue => {
  let value!: AppContextValue
  const base = {
    userProfile: userProfilePlaceholder,
    mutateUserProfile: vi.fn(),
    currentWorkspace: {
      ...initialWorkspaceInfo,
      id: 'workspace-1',
    },
    isCurrentWorkspaceManager: false,
    isCurrentWorkspaceOwner: false,
    isCurrentWorkspaceEditor: false,
    isCurrentWorkspaceDatasetOperator: false,
    mutateCurrentWorkspace: vi.fn(),
    langGeniusVersionInfo: initialLangGeniusVersionInfo,
    isLoadingCurrentWorkspace: false,
    isValidatingCurrentWorkspace: false,
  }
  const useSelector: AppContextValue['useSelector'] = selector => selector(value)
  value = {
    ...base,
    useSelector,
  }
  return value
}

describe('AgentResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the real child items, shows the circular warning, and opens nested action logs', async () => {
    const user = userEvent.setup()
    const onShowAgentOrToolLog = vi.fn()
    const grandchild = createLogItem({ message_id: 'grandchild', label: 'Tool Call' })
    const child = createLogItem({
      message_id: 'child',
      label: 'Child Tool',
      children: [grandchild],
    })
    const top = createLogItem({ message_id: 'top', label: 'Top', hasCircle: true })

    render(
      <AppContext.Provider value={createAppContextValue()}>
        <AgentResultPanel
          agentOrToolLogItemStack={[top]}
          agentOrToolLogListMap={{ top: [child] }}
          onShowAgentOrToolLog={onShowAgentOrToolLog}
        />
      </AppContext.Provider>,
    )

    expect(screen.getByText('runLog.circularInvocationTip')).toBeInTheDocument()

    await user.click(screen.getByText('Child Tool'))
    await user.click(screen.getByRole('button', { name: /1 Action Logs/i }))

    expect(onShowAgentOrToolLog).toHaveBeenCalledWith(child)
  })
})
