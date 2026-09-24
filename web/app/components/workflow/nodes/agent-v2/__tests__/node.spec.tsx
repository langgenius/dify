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
    const { container } = render(<AgentV2Node id="agent-node" data={createData()} />)

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toHaveClass(
      'px-2.5',
      'py-0.5',
      'system-2xs-medium-uppercase',
    )
    expect(screen.getByText('Nadia')).toHaveClass('system-xs-regular', 'text-text-secondary')
    expect(container.querySelector('.bg-workflow-block-parma-bg')).toHaveClass(
      'gap-1',
      'rounded-lg',
      'p-1',
    )
    expect(container.querySelector('.h-1.px-3')).not.toBeInTheDocument()
  })

  it('renders a stable roster placeholder while agent detail is loading', () => {
    mockUseAgentRosterDetail.mockReturnValue({ data: undefined })

    const { container } = render(<AgentV2Node id="agent-node" data={createData()} />)

    expect(container.querySelector('.bg-workflow-block-parma-bg')).toBeInTheDocument()
    expect(container.querySelector('.h-2.w-20')).toBeInTheDocument()
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
    expect(screen.getByText('workflow.nodes.agent.roster.inlineSetup.name')).toHaveClass(
      'system-xs-regular',
      'text-text-secondary',
    )
    expect(screen.getByText('workflow.nodes.agent.roster.inlineSetup.type')).toHaveClass(
      'system-2xs-regular',
      'text-text-tertiary',
    )
  })

  it('renders a stable inline placeholder while agent detail is loading', () => {
    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      isPending: true,
      data: undefined,
    })

    const { container } = render(
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
      screen.queryByText('workflow.nodes.agent.roster.inlineSetup.name'),
    ).not.toBeInTheDocument()
    expect(container.querySelector('.bg-workflow-block-parma-bg')).toBeInTheDocument()
    expect(
      container.querySelector('.size-8.shrink-0.rounded-full.bg-text-quaternary\\/20'),
    ).toBeInTheDocument()
    expect(container.querySelector('.h-2.w-20')).toBeInTheDocument()
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
