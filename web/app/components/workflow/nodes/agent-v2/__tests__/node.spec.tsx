import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import { screen } from '@testing-library/react'
import { renderWorkflowFlowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { ErrorHandleTypeEnum } from '../../_base/components/error-handle/types'
import BaseNode from '../../_base/node'
import { AgentV2Node } from '../node'

const { mockUseAgentRosterDetail, mockUseWorkflowInlineAgentDetail } = vi.hoisted(() => ({
  mockUseAgentRosterDetail: vi.fn(),
  mockUseWorkflowInlineAgentDetail: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
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

vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useAgentRosterDetail: (agentId?: string) => mockUseAgentRosterDetail(agentId),
  useWorkflowInlineAgentDetail: (nodeId?: string, agentId?: string | null) =>
    mockUseWorkflowInlineAgentDetail(nodeId, agentId),
  useCreateInlineAgentBinding: () => ({ createInlineAgentBinding: vi.fn() }),
}))

vi.mock('../../../hooks/use-tool-icon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/use-tool-icon')>()),
  useToolIcon: () => undefined,
}))

vi.mock('@/app/components/workflow/collaboration/hooks/use-collaboration', () => ({
  useCollaboration: () => ({ nodePanelPresence: {} }),
}))

// BaseNode reads plugin permissions even when rendering an Agent node.
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: [] }))
})

const createData = (overrides: Partial<AgentV2NodeType> = {}): AgentV2NodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.AgentV2,
  agent_binding: {
    binding_type: 'roster_agent',
    agent_id: 'agent-1',
  },
  agent_node_kind: 'dify_agent',
  version: '2',
  ...overrides,
})

describe('agent/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAgentRosterDetail.mockImplementation((agentId?: string) => ({
      isPending: false,
      data: agentId
        ? {
            id: agentId,
            name: 'Nadia',
            description: 'Clarification Drafter',
            icon: 'N',
            icon_background: '#E9D7FE',
            icon_type: 'emoji',
          }
        : undefined,
    }))
    mockUseWorkflowInlineAgentDetail.mockImplementation(
      (nodeId?: string, agentId?: string | null) => ({
        isPending: false,
        data:
          nodeId && agentId
            ? {
                agent: {
                  id: agentId,
                  name: 'Workflow Agent 1',
                  description: '',
                  scope: 'workflow_only',
                  status: 'active',
                },
              }
            : undefined,
      }),
    )
  })

  it('renders the selected roster agent', () => {
    render(<AgentV2Node id="agent-node" data={createData()} />)

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
    expect(screen.getByText('Nadia')).toBeInTheDocument()
  })

  it('renders a stable roster placeholder while agent detail is loading', () => {
    mockUseAgentRosterDetail.mockReturnValue({ data: undefined })

    render(<AgentV2Node id="agent-node" data={createData()} />)

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
    expect(screen.queryByText('Nadia')).not.toBeInTheDocument()
  })

  it('renders the fixed inline setup name when workflow composer state is loaded', () => {
    render(
      <AgentV2Node
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
      />,
    )

    expect(mockUseAgentRosterDetail).toHaveBeenCalledWith(undefined)
    expect(mockUseWorkflowInlineAgentDetail).toHaveBeenCalledWith('agent-node', 'inline-agent-1')
    expect(screen.queryByText('Workflow Agent 1')).not.toBeInTheDocument()
    expect(
      screen.getByText('workflowAgent.nodes.agent.roster.inlineSetup.name'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('workflowAgent.nodes.agent.roster.inlineSetup.type'),
    ).toBeInTheDocument()
  })

  it('renders a stable inline placeholder while agent detail is loading', () => {
    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      isPending: true,
      data: undefined,
    })

    render(
      <AgentV2Node
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
      />,
    )

    expect(
      screen.queryByText('workflowAgent.nodes.agent.roster.inlineSetup.name'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
  })

  it('renders an error state when no roster agent is selected', () => {
    render(<AgentV2Node id="agent-node" data={createData({ agent_binding: undefined })} />)

    expect(screen.getByText(/workflow.nodes.agent.roster.label:error:/)).toHaveTextContent(
      'workflow.errorMsg.fieldRequired',
    )
  })

  it('switches the composed card between route handles and source while preserving the failure exit', () => {
    const data = createData({
      error_strategy: ErrorHandleTypeEnum.failBranch,
      agent_output_routes: {
        enabled: true,
        routes: [
          { id: 'accepted', name: 'Accepted' },
          { id: 'rejected', name: 'Rejected' },
        ],
      },
    })
    const card = (data: AgentV2NodeType) => (
      <BaseNode id="agent-node" data={data}>
        <AgentV2Node id="agent-node" data={data} />
      </BaseNode>
    )
    const { container, rerender } = render(card(data))
    // ReactFlow consumes these IDs to connect and restore workflow edges.
    const sourceHandles = () =>
      Array.from(container.querySelectorAll('.react-flow__handle.source'), (handle) =>
        handle.getAttribute('data-handleid'),
      ).sort()

    expect(sourceHandles()).toEqual(['accepted', 'fail-branch', 'rejected'])
    rerender(
      card({
        ...data,
        agent_output_routes: { ...data.agent_output_routes!, enabled: false },
      }),
    )
    expect(sourceHandles()).toEqual(['fail-branch', 'source'])
  })
})
