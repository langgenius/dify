import type { ReactNode } from 'react'
import type { AgentNodeType } from '../types'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentPanel } from '../panel'

const {
  mockEditorFocus,
  mockEditorUpdate,
  mockInsertNodes,
  mockQueryOptions,
  mockPromptEditorProps,
  mockSetInputs,
  mockUseQuery,
  mockUseNodeCrud,
} = vi.hoisted(() => ({
  mockEditorFocus: vi.fn(),
  mockEditorUpdate: vi.fn((callback: () => void) => callback()),
  mockInsertNodes: vi.fn(),
  mockQueryOptions: vi.fn((options: unknown) => ({ queryKey: ['agent-composer', options] })),
  mockPromptEditorProps: [] as PromptEditorProps[],
  mockSetInputs: vi.fn(),
  mockUseQuery: vi.fn(),
  mockUseNodeCrud: vi.fn(),
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
  default: (id: string, data: AgentNodeType) => mockUseNodeCrud(id, data),
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
  useWorkflowVariableType: () => vi.fn(),
}))

const createData = (overrides: Partial<AgentNodeType> = {}): AgentNodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.Agent,
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

const panelProps = {} as NodePanelProps<AgentNodeType>['panelProps']

describe('agent/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPromptEditorProps.length = 0
    mockUseQuery.mockReturnValue({ data: undefined })
    mockUseNodeCrud.mockImplementation((_id: string, data: AgentNodeType) => ({
      inputs: data,
      setInputs: mockSetInputs,
    }))
  })

  it('renders selected roster agent trigger and default Agent v2 output vars', () => {
    render(
      <AgentPanel
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
    expect(mockQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
          node_id: 'agent-node',
        },
      },
    })
  })

  it('renders effective declared outputs from the agent composer', () => {
    mockUseQuery.mockReturnValue({
      data: {
        effective_declared_outputs: [
          {
            description: 'Short answer',
            name: 'summary',
            type: 'string',
          },
          {
            name: 'attachments',
            type: 'array',
            array_item: {
              type: 'file',
            },
          },
          {
            name: 'metadata',
            type: 'object',
          },
        ],
      },
    })

    render(
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('summary:String:Short answer')).toBeInTheDocument()
    expect(screen.getByText('attachments:Array[File]:')).toBeInTheDocument()
    expect(screen.getByText('metadata:Object:')).toBeInTheDocument()
    expect(screen.queryByText('text:String:workflow.nodes.agent.outputVars.text')).not.toBeInTheDocument()
  })

  it('uses the composer roster agent when the node is bound to a roster agent', () => {
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
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('Composer Agent')).toBeInTheDocument()
    expect(screen.getByText('Backend-bound agent')).toBeInTheDocument()
    expect(screen.queryByText('Nadia')).not.toBeInTheDocument()
  })

  it('keeps the graph roster draft visible when composer has no binding yet', () => {
    mockUseQuery.mockReturnValue({
      data: {
        agent: undefined,
        binding: undefined,
      },
    })

    render(
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('Nadia')).toBeInTheDocument()
    expect(screen.getByText('Clarification Drafter')).toBeInTheDocument()
  })

  it('does not show stale graph roster data when the composer binding is not roster-backed', () => {
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
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByText('workflow.nodes.agent.roster.label')).not.toBeInTheDocument()
    expect(screen.queryByText('Nadia')).not.toBeInTheDocument()
  })

  it('uses composer descriptions for default composer outputs', () => {
    mockUseQuery.mockReturnValue({
      data: {
        effective_declared_outputs: [
          {
            description: 'Free-form text answer.',
            name: 'text',
            type: 'string',
          },
          {
            description: 'Files produced by the agent.',
            name: 'files',
            type: 'array',
            array_item: {
              type: 'file',
            },
          },
          {
            description: 'Free-form JSON object.',
            name: 'json',
            type: 'object',
          },
        ],
      },
    })

    render(
      <AgentPanel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('text:String:Free-form text answer.')).toBeInTheDocument()
    expect(screen.getByText('files:Array[File]:Files produced by the agent.')).toBeInTheDocument()
    expect(screen.getByText('json:Object:Free-form JSON object.')).toBeInTheDocument()
    expect(screen.queryByText('files:Array[File]:workflow.nodes.agent.outputVars.files.title')).not.toBeInTheDocument()
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
    expect(screen.getByText('workflow.nodes.agent.task.label')).toBeInTheDocument()
    expect(screen.getByText('text:String:workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
  })

  it('updates agent task and opens prompt insertion shortcuts', () => {
    render(
      <AgentPanel
        id="agent-node"
        data={createData({ agent_task: 'Clarify tender' })}
        panelProps={panelProps}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' })
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
})
