import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AgentV2Panel } from '../panel'

const {
  mockEditorFocus,
  mockEditorUpdate,
  mockHandleNodeDataUpdateWithSyncDraft,
  mockInvalidateQueries,
  mockInsertNodes,
  mockMutateAsync,
  mockPromptEditorProps,
  mockSetQueryData,
  mockSetInputs,
  mockUseComposerQuery,
  mockUseNodeCrud,
} = vi.hoisted(() => ({
  mockEditorFocus: vi.fn(),
  mockEditorUpdate: vi.fn((callback: () => void) => callback()),
  mockHandleNodeDataUpdateWithSyncDraft: vi.fn((_payload, options) => options?.callback?.onSuccess?.()),
  mockInvalidateQueries: vi.fn(),
  mockInsertNodes: vi.fn(),
  mockMutateAsync: vi.fn(),
  mockPromptEditorProps: [] as PromptEditorProps[],
  mockSetQueryData: vi.fn(),
  mockSetInputs: vi.fn(),
  mockUseComposerQuery: vi.fn(),
  mockUseNodeCrud: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  skipToken: Symbol('skipToken'),
  useMutation: () => ({
    mutateAsync: mockMutateAsync,
  }),
  useQuery: () => mockUseComposerQuery(),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
  }),
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
                    queryKey: (input: unknown) => ['workflow-agent-composer', input],
                    queryOptions: (options: unknown) => ({
                      queryKey: ['workflow-agent-composer', options],
                    }),
                  },
                  put: {
                    mutationOptions: (options?: unknown) => options ?? {},
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

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowId: string } }) => unknown) => selector({
    configsMap: {
      flowId: 'app-1',
    },
  }),
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
    onSelect: (agent: NonNullable<AgentV2NodeType['agent_roster']>) => void
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
  agent_roster: {
    id: 'agent-1',
    name: 'Nadia',
    description: 'Clarification Drafter',
    icon: 'N',
    icon_background: '#E9D7FE',
    icon_type: 'emoji',
    role: 'Researcher',
  },
  version: '2',
  ...overrides,
})

const panelProps = {} as NodePanelProps<AgentV2NodeType>['panelProps']

const createComposerState = (overrides: Record<string, unknown> = {}) => ({
  variant: 'workflow',
  agent: {
    id: 'agent-1',
    name: 'Nadia',
    description: 'Clarification Drafter',
    scope: 'roster',
    status: 'active',
    active_config_snapshot_id: 'version-1',
  },
  active_config_snapshot: {
    id: 'version-1',
    version: 1,
  },
  binding: {
    id: 'binding-1',
    binding_type: 'roster_agent',
    agent_id: 'agent-1',
    current_snapshot_id: 'version-1',
    workflow_id: 'workflow-1',
    node_id: 'agent-node',
  },
  soul_lock: {
    locked: true,
    can_unlock: true,
  },
  agent_soul: {},
  node_job: {
    schema_version: 1,
    mode: 'tell_agent_what_to_do',
    workflow_prompt: '',
    previous_node_output_refs: [],
    declared_outputs: [],
    human_contacts: [],
    metadata: {},
  },
  effective_declared_outputs: [
    {
      name: 'text',
      type: 'string',
      required: false,
      description: 'Free-form text answer.',
    },
    {
      name: 'files',
      type: 'array',
      required: false,
      description: 'Files produced by the agent.',
      array_item: {
        type: 'file',
      },
    },
    {
      name: 'json',
      type: 'object',
      required: false,
      description: 'Free-form JSON object.',
    },
  ],
  save_options: ['node_job_only'],
  ...overrides,
})

describe('agent/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPromptEditorProps.length = 0
    mockMutateAsync.mockResolvedValue(createComposerState())
    mockUseComposerQuery.mockReturnValue({
      data: createComposerState(),
    })
    mockUseNodeCrud.mockImplementation((_id: string, data: AgentV2NodeType) => ({
      inputs: data,
      setInputs: mockSetInputs,
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
        data={createData({ agent_roster: undefined })}
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
          agent_roster: expect.objectContaining({
            id: 'agent-2',
            name: 'Mara',
            role: 'Analyst',
          }),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
    expect(mockInvalidateQueries).toHaveBeenCalled()
  })

  it('does not fall back to the roster agent description when role is empty', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_roster: {
            id: 'agent-1',
            name: 'Nadia',
            description: 'Clarification Drafter',
            icon: 'N',
            icon_background: '#E9D7FE',
            icon_type: 'emoji',
            role: '',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('Nadia')).toBeInTheDocument()
    expect(screen.queryByText('Clarification Drafter')).not.toBeInTheDocument()
  })

  it('updates agent task and opens prompt insertion shortcuts', () => {
    mockUseComposerQuery.mockReturnValue({
      data: createComposerState({
        node_job: {
          schema_version: 1,
          mode: 'tell_agent_what_to_do',
          workflow_prompt: 'Composer task',
          previous_node_output_refs: [],
          declared_outputs: [],
          human_contacts: [],
          metadata: {},
        },
      }),
    })

    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({ agent_task: 'Graph task' })}
        panelProps={panelProps}
      />,
    )

    const editor = screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' })
    expect(editor).toHaveValue('Composer task')

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

  it('saves agent task to the workflow composer node job', async () => {
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

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      params: {
        app_id: 'app-1',
        node_id: 'agent-node',
      },
      body: {
        variant: 'workflow',
        save_strategy: 'node_job_only',
        node_job: {
          schema_version: 1,
          mode: 'tell_agent_what_to_do',
          workflow_prompt: 'Use the previous result',
          previous_node_output_refs: [],
          declared_outputs: [],
          human_contacts: [],
          metadata: {},
        },
      },
    }))
  })

  it('renders effective declared outputs from the workflow composer', () => {
    mockUseComposerQuery.mockReturnValue({
      data: createComposerState({
        effective_declared_outputs: [
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
      }),
    })

    render(
      <AgentV2Panel
        id="agent-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('summary:String:Short summary')).toBeInTheDocument()
    expect(screen.getByText('attachments:Array[File]:Generated files')).toBeInTheDocument()
    expect(screen.queryByText('text:String:workflow.nodes.agent.outputVars.text')).not.toBeInTheDocument()
  })
})
