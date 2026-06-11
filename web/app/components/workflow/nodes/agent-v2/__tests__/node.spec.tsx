import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentV2Node } from '../node'

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
  })

  it('renders the selected roster agent', () => {
    render(
      <AgentV2Node
        id="agent-node"
        data={createData()}
      />,
    )

    expect(screen.getByText(/workflow.nodes.agent.roster.label:normal:/)).toHaveTextContent('Nadia')
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
