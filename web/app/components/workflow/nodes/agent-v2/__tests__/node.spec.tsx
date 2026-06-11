import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentV2Node } from '../node'

const {
  mockQueryOptions,
  mockUseQuery,
} = vi.hoisted(() => ({
  mockQueryOptions: vi.fn((options: unknown) => ({ queryKey: ['agent-composer', options] })),
  mockUseQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  skipToken: Symbol.for('skipToken'),
  useQuery: (options: unknown) => mockUseQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        workflows: {
          draft: {
            nodes: {
              byNodeId: {
                agentComposer: {
                  get: {
                    queryOptions: mockQueryOptions,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}))

vi.mock('../../../hooks-store/store', () => ({
  useHooksStore: <T,>(selector: (state: { configsMap?: { flowId: string } }) => T) =>
    selector({ configsMap: { flowId: 'app-1' } }),
}))

vi.mock('../../_base/components/setting-item', () => ({
  SettingItem: ({
    label,
    status,
    tooltip,
    children,
  }: {
    label: ReactNode
    status?: string
    tooltip?: string
    children?: ReactNode
  }) => (
    <div>
      {`${label}:${status || 'normal'}:${tooltip || ''}`}
      {children}
    </div>
  ),
}))

const createData = (overrides: Partial<AgentV2NodeType> = {}): AgentV2NodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.AgentV2,
  agent_node_kind: 'dify_agent',
  agent_roster: {
    id: 'agent-1',
    name: 'Nadia',
    description: 'Clarification Drafter',
    icon: 'N',
    icon_background: '#E9D7FE',
    icon_type: 'emoji',
  },
  version: '2',
  ...overrides,
})

describe('agent/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({ data: undefined })
  })

  it('renders the selected roster agent', () => {
    render(
      <AgentV2Node
        id="agent-node"
        data={createData()}
      />,
    )

    expect(screen.getByText(/workflow.nodes.agent.roster.label:normal:/)).toHaveTextContent('Nadia')
    expect(mockQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
          node_id: 'agent-node',
        },
      },
    })
  })

  it('uses the composer roster agent when available', () => {
    mockUseQuery.mockReturnValue({
      data: {
        agent: {
          active_config_snapshot_id: 'snapshot-1',
          description: 'Backend-bound agent',
          id: 'agent-1',
          name: 'Composer Agent',
          scope: 'roster',
          status: 'active',
        },
        binding: {
          agent_id: 'agent-1',
          binding_type: 'roster_agent',
          current_snapshot_id: 'snapshot-1',
          id: 'binding-1',
          node_id: 'agent-node',
          workflow_id: 'workflow-1',
        },
      },
    })

    render(
      <AgentV2Node
        id="agent-node"
        data={createData()}
      />,
    )

    expect(screen.getByText(/workflow.nodes.agent.roster.label:normal:/)).toHaveTextContent('Composer Agent')
    expect(screen.queryByText('Nadia')).not.toBeInTheDocument()
  })

  it('does not show stale graph roster data when composer binding is not roster-backed', () => {
    mockUseQuery.mockReturnValue({
      data: {
        agent: {
          active_config_snapshot_id: 'snapshot-1',
          description: 'Workflow-only agent',
          id: 'agent-2',
          name: 'Inline Agent',
          scope: 'workflow_only',
          status: 'active',
        },
        binding: {
          agent_id: 'agent-2',
          binding_type: 'inline_agent',
          current_snapshot_id: 'snapshot-1',
          id: 'binding-1',
          node_id: 'agent-node',
          workflow_id: 'workflow-1',
        },
      },
    })

    render(
      <AgentV2Node
        id="agent-node"
        data={createData()}
      />,
    )

    expect(screen.getByText(/workflow.nodes.agent.roster.label:error:/)).toHaveTextContent('workflow.errorMsg.fieldRequired')
    expect(screen.queryByText('Nadia')).not.toBeInTheDocument()
  })

  it('renders an error state when no roster agent is selected', () => {
    render(
      <AgentV2Node
        id="agent-node"
        data={createData({ agent_roster: undefined })}
      />,
    )

    expect(screen.getByText(/workflow.nodes.agent.roster.label:error:/)).toHaveTextContent('workflow.errorMsg.fieldRequired')
  })
})
