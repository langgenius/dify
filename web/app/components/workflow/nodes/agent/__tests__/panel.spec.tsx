import type { ReactNode } from 'react'
import type { AgentNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentPanel } from '../panel'

vi.mock('../../_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type, description }: { name: string, type: string, description?: string }) => (
    <div>{`${name}:${type}:${description || ''}`}</div>
  ),
}))

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
  agent_roster: {
    id: 'agent-1',
    name: 'Nadia',
    description: 'Clarification Drafter',
    icon: 'N',
    icon_background: '#E9D7FE',
    icon_type: 'emoji',
  },
  ...overrides,
})

const panelProps = {} as NodePanelProps<AgentNodeType>['panelProps']

describe('agent/panel', () => {
  it('renders selected roster agent trigger and fixed output vars', () => {
    render(
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
    expect(screen.getByText('Nadia')).toBeInTheDocument()
    expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(screen.getByText('usage:object:workflow.nodes.agent.outputVars.usage')).toBeInTheDocument()
    expect(screen.getByText('files:Array[File]:workflow.nodes.agent.outputVars.files.title')).toBeInTheDocument()
    expect(screen.getByText('json:Array[Object]:workflow.nodes.agent.outputVars.json')).toBeInTheDocument()
  })

  it('opens and closes the roster agent layered panel', () => {
    render(
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }))

    const panel = screen.getByRole('dialog', { name: 'Nadia' })
    expect(panel).toBeInTheDocument()
    expect(within(panel).getByText('Clarification Drafter')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'workflow.nodes.agent.roster.editInConsole' })).toHaveAttribute('href', '/roster/agent/agent-1/configure')
    expect(within(panel).getByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' })).toBeInTheDocument()

    fireEvent.keyDown(panel, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Nadia' })).not.toBeInTheDocument()
  })

  it('does not render roster metadata when no roster agent is selected', () => {
    render(
      <AgentPanel
        id="agent-node"
        data={createData({ agent_roster: undefined })}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByText('workflow.nodes.agent.roster.label')).not.toBeInTheDocument()
    expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
  })
})
