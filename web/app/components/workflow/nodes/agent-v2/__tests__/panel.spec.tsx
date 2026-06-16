import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentV2Panel } from '../panel'

const {
  mockEditorFocus,
  mockEditorUpdate,
  mockHandleNodeDataUpdateWithSyncDraft,
  mockInsertNodes,
  mockPromptEditorProps,
  mockSetInputs,
  mockUseAgentRosterDetail,
  mockUseNodeCrud,
} = vi.hoisted(() => ({
  mockEditorFocus: vi.fn(),
  mockEditorUpdate: vi.fn((callback: () => void) => callback()),
  mockHandleNodeDataUpdateWithSyncDraft: vi.fn((_payload, options) => options?.callback?.onSuccess?.()),
  mockInsertNodes: vi.fn(),
  mockPromptEditorProps: [] as PromptEditorProps[],
  mockSetInputs: vi.fn(),
  mockUseAgentRosterDetail: vi.fn(),
  mockUseNodeCrud: vi.fn(),
}))

vi.mock('../../_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type, description }: { name: string, type: string, description?: string }) => (
    <div>{`${name}:${type}:${description || ''}`}</div>
  ),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: PromptEditorProps) => {
    mockPromptEditorProps.push(props)

    return (
      <>
        <textarea
          aria-label="workflow.nodes.agent.task.label"
          placeholder={typeof props.placeholder === 'string' ? props.placeholder : undefined}
          value={props.value}
          onChange={event => props.onChange?.(event.currentTarget.value)}
        />
        {props.children}
      </>
    )
  },
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [{
    focus: mockEditorFocus,
    update: mockEditorUpdate,
  }],
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()

  return {
    ...actual,
    $insertNodes: mockInsertNodes,
  }
})

vi.mock('@/app/components/base/prompt-editor/plugins/custom-text/node', () => ({
  $createCustomTextNode: (text: string) => ({
    getTextContent: () => text,
  }),
}))

vi.mock('../../_base/hooks/use-node-crud', () => ({
  default: (id: string, data: AgentV2NodeType) => mockUseNodeCrud(id, data),
}))

vi.mock('@/app/components/workflow/block-selector/agent-selector', () => ({
  AgentSelectorContent: ({
    onSelect,
  }: {
    onSelect: (agent: {
      description: string
      icon: string
      icon_background: string
      icon_type: 'emoji'
      id: string
      name: string
      role: string
    }) => void
  }) => (
    <button
      type="button"
      onClick={() => onSelect({
        id: 'agent-2',
        name: 'Mara',
        description: 'Tender Analyst',
        icon: 'M',
        icon_background: '#D1E9FF',
        icon_type: 'emoji',
        role: 'Analyst',
      })}
    >
      Select Mara
    </button>
  ),
}))

vi.mock('../hooks', () => ({
  useAgentRosterDetail: (agentId?: string) => mockUseAgentRosterDetail(agentId),
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: () => ({
    availableVars: [{
      nodeId: 'start',
      title: 'START',
      vars: [{ variable: 'question', type: 'string' }],
    }],
    availableNodesWithParent: [{
      id: 'start',
      data: {
        title: 'START',
        type: BlockEnum.Start,
      },
      position: { x: 0, y: 0 },
    }],
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
  useWorkflowVariableType: () => vi.fn(),
}))

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

const panelProps = {} as NodePanelProps<AgentV2NodeType>['panelProps']

describe('agent/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPromptEditorProps.length = 0
    mockUseNodeCrud.mockImplementation((_id: string, data: AgentV2NodeType) => ({
      inputs: data,
      setInputs: mockSetInputs,
    }))
    mockUseAgentRosterDetail.mockImplementation((agentId?: string) => ({
      data: agentId
        ? {
            id: agentId,
            name: 'Nadia',
            description: 'Clarification Drafter',
            icon: 'N',
            icon_background: '#E9D7FE',
            icon_type: 'emoji',
            role: 'Researcher',
          }
        : undefined,
    }))
  })

  it('renders selected roster agent trigger and default Agent v2 output vars', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
    expect(screen.getByText('Nadia')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.task.label')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workflow.nodes.agent.task.tooltip' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'workflow.nodes.agent.advancedSetting' })).toBeInTheDocument()
    expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(screen.queryByText('usage:object:workflow.nodes.agent.outputVars.usage')).not.toBeInTheDocument()
    expect(screen.getByText('files:Array[File]:workflow.nodes.agent.outputVars.files.title')).toBeInTheDocument()
    expect(screen.getByText('json:Object:workflow.nodes.agent.outputVars.json')).toBeInTheDocument()
  })

  it('opens and closes the roster agent layered panel', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }))

    const panel = screen.getByRole('dialog', { name: 'Nadia' })
    expect(panel).toBeInTheDocument()
    expect(within(panel).getByText('Researcher')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'workflow.nodes.agent.roster.editInConsole' })).toHaveAttribute('href', '/roster/agent/agent-1/configure')
    expect(within(panel).getByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' })).toBeInTheDocument()

    fireEvent.keyDown(panel, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Nadia' })).not.toBeInTheDocument()
  })

  it('renders a required roster state when no roster agent is selected', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({ agent_binding: undefined })}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
    expect(screen.getByText(/^workflow\.errorMsg\.fieldRequired/)).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.task.label')).toBeInTheDocument()
    expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
  })

  it('updates roster agent binding from the selector', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.roster.change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Mara' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_binding: {
            binding_type: 'roster_agent',
            agent_id: 'agent-2',
          },
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('does not fall back to the roster agent description when role is empty', () => {
    mockUseAgentRosterDetail.mockReturnValue({
      data: {
        id: 'agent-1',
        name: 'Nadia',
        description: 'Clarification Drafter',
        icon: 'N',
        icon_background: '#E9D7FE',
        icon_type: 'emoji',
        role: '',
      },
    })
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('Nadia')).toBeInTheDocument()
    expect(screen.queryByText('Clarification Drafter')).not.toBeInTheDocument()
  })

  it('updates agent task and opens prompt insertion shortcuts', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({ agent_task: 'Graph task' })}
        panelProps={panelProps}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' })
    expect(editor).toHaveValue('Graph task')

    fireEvent.change(editor, { target: { value: 'Clarify {{#start.question#}}' } })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      agent_task: 'Clarify {{#start.question#}}',
    }))
    expect(mockPromptEditorProps[0]?.workflowVariableBlock).toMatchObject({
      show: true,
    })
    expect(mockPromptEditorProps[0]?.contextBlock).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.task.insert' }))
    expect(mockEditorFocus).toHaveBeenCalled()
    expect(mockInsertNodes.mock.calls[0]?.[0]?.[0]?.getTextContent()).toBe('/')

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.task.mention' }))
    expect(mockInsertNodes.mock.calls[1]?.[0]?.[0]?.getTextContent()).toBe('{')
  })

  it('saves agent task to workflow draft node data', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' }), {
      target: {
        value: 'Use the previous result',
      },
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      agent_task: 'Use the previous result',
    }))
  })

  it('renders declared outputs from workflow draft graph data', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
              description: 'Short summary',
            },
            {
              name: 'attachments',
              type: 'array',
              description: 'Generated files',
              array_item: {
                type: 'file',
              },
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('summary:String:Short summary')).toBeInTheDocument()
    expect(screen.getByText('attachments:Array[File]:Generated files')).toBeInTheDocument()
    expect(screen.queryByText('text:String:workflow.nodes.agent.outputVars.text')).not.toBeInTheDocument()
  })
})
