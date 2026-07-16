import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import { AgentV2Panel } from '../panel'

const {
  mockEditorFocus,
  mockEditorUpdate,
  mockHandleNodeDataUpdate,
  mockHandleNodeDataUpdateWithSyncDraft,
  mockInsertNodes,
  mockOrchestratePanelContentProps,
  mockOutputVarsProps,
  mockPromptEditorProps,
  mockCopyFromRosterMutate,
  mockCopyFromRosterState,
  mockConfigsMap,
  mockCreateInlineAgentBinding,
  mockSetInputs,
  mockStoreState,
  mockUseAgentRosterDetail,
  mockWorkflowInlineAgentDetailRefetch,
  mockUseWorkflowInlineAgentDetail,
  mockUseNodeCrud,
} = vi.hoisted(() => ({
  mockEditorFocus: vi.fn(),
  mockEditorUpdate: vi.fn((callback: () => void) => callback()),
  mockHandleNodeDataUpdate: vi.fn(),
  mockHandleNodeDataUpdateWithSyncDraft: vi.fn((_payload, options) =>
    options?.callback?.onSuccess?.(),
  ),
  mockInsertNodes: vi.fn(),
  mockOrchestratePanelContentProps: [] as Array<{
    agentId?: string
    appId?: string
    inlineComposerState?: unknown
    nodeId: string
    open: boolean
  }>,
  mockOutputVarsProps: [] as Array<{
    collapsed?: boolean
    onCollapse?: (collapsed: boolean) => void
  }>,
  mockPromptEditorProps: [] as PromptEditorProps[],
  mockCopyFromRosterMutate: vi.fn(),
  mockCopyFromRosterState: {
    isPending: false,
  },
  mockConfigsMap: {
    flowId: 'app-1',
    flowType: 'appFlow' as FlowType,
  },
  mockCreateInlineAgentBinding: vi.fn(),
  mockSetInputs: vi.fn(),
  mockStoreState: {
    appId: 'app-1',
    openInlineAgentPanelNodeId: undefined as string | undefined,
    setOpenInlineAgentPanelNodeId: vi.fn(),
  },
  mockUseAgentRosterDetail: vi.fn(),
  mockWorkflowInlineAgentDetailRefetch: vi.fn(),
  mockUseWorkflowInlineAgentDetail: vi.fn(),
  mockUseNodeCrud: vi.fn(),
}))

vi.mock('../../_base/components/output-vars', () => ({
  __esModule: true,
  default: ({
    children,
    collapsed,
    onCollapse,
  }: {
    children: ReactNode
    collapsed?: boolean
    onCollapse?: (collapsed: boolean) => void
  }) => {
    mockOutputVarsProps.push({ collapsed, onCollapse })

    return <div>{children}</div>
  },
  VarItem: ({ name, type, description }: { name: string; type: string; description?: string }) => (
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
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
          onBlur={props.onBlur}
          onFocus={props.onFocus}
        />
        {props.children}
      </>
    )
  },
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [
    {
      focus: mockEditorFocus,
      update: mockEditorUpdate,
    },
  ],
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useMutation: () => ({
      isPending: mockCopyFromRosterState.isPending,
      mutate: mockCopyFromRosterMutate,
    }),
  }
})

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
    onStartFromScratch,
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
    onStartFromScratch?: () => void
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: 'agent-2',
            name: 'Mara',
            description: 'Tender Analyst',
            icon: 'M',
            icon_background: '#D1E9FF',
            icon_type: 'emoji',
            role: 'Analyst',
          })
        }
      >
        Select Mara
      </button>
      {onStartFromScratch && (
        <button type="button" onClick={onStartFromScratch}>
          Start from Scratch
        </button>
      )}
    </>
  ),
}))

vi.mock('../hooks', () => ({
  useAgentRosterDetail: (agentId?: string) => mockUseAgentRosterDetail(agentId),
  useCreateInlineAgentBinding: () => ({
    createInlineAgentBinding: mockCreateInlineAgentBinding,
    isCreatingInlineAgent: false,
  }),
  useWorkflowInlineAgentDetail: (nodeId?: string, agentId?: string | null) =>
    mockUseWorkflowInlineAgentDetail(nodeId, agentId),
}))

vi.mock('../components/agent-orchestrate-panel-content', () => ({
  WorkflowRosterAgentOrchestratePanelContent: (props: {
    agentId?: string
    nodeId: string
    open: boolean
  }) => {
    mockOrchestratePanelContentProps.push(props)

    return <div role="region" aria-label="readonly-roster-orchestrate-panel" />
  },
  WorkflowInlineAgentConfigureWorkspace: (props: {
    agentId?: string
    appId?: string
    inlineComposerState?: unknown
    nodeId: string
    onClose?: () => void
    onSaved?: (binding: {
      agent_id?: string | null
      binding_type: 'inline_agent' | 'roster_agent'
      current_snapshot_id?: string | null
    }) => void
    onSaveInlineToRoster?: () => void
    open: boolean
  }) => {
    mockOrchestratePanelContentProps.push(props)

    return (
      <div role="region" aria-label="inline-orchestrate-panel">
        <button type="button" onClick={props.onSaveInlineToRoster}>
          Inline workspace more
        </button>
        <button
          type="button"
          onClick={() => {
            props.onSaved?.({
              binding_type: 'inline_agent',
              agent_id: 'inline-agent-1',
              current_snapshot_id: 'latest-snapshot-2',
            })
          }}
        >
          Autosave inline workspace
        </button>
      </div>
    )
  },
}))

vi.mock('../components/save-inline-agent-to-roster-dialog', () => ({
  SaveInlineAgentToRosterDialog: ({
    open,
    onSaved,
  }: {
    open: boolean
    onSaved: (binding: {
      agent_id?: string | null
      binding_type: 'inline_agent' | 'roster_agent'
      current_snapshot_id?: string | null
      id: string
      node_id: string
      workflow_id: string
    }) => void
  }) =>
    open ? (
      <div role="dialog" aria-label="save-inline-agent-to-roster">
        <button
          type="button"
          onClick={() =>
            onSaved({
              id: 'binding-1',
              binding_type: 'roster_agent',
              agent_id: 'saved-roster-agent',
              current_snapshot_id: 'saved-snapshot',
              workflow_id: 'workflow-1',
              node_id: 'agent-node',
            })
          }
        >
          Save inline agent to roster
        </button>
      </div>
    ) : null,
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: () => ({
    availableVars: [
      {
        nodeId: 'start',
        title: 'START',
        vars: [{ variable: 'question', type: 'string' }],
      },
    ],
    availableNodesWithParent: [
      {
        id: 'start',
        data: {
          title: 'START',
          type: BlockEnum.Start,
        },
        position: { x: 0, y: 0 },
      },
    ],
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: () => ({
    handleNodeDataUpdate: mockHandleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
  }),
  useWorkflowVariableType: () => vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: typeof mockConfigsMap }) => unknown) =>
    selector({ configsMap: mockConfigsMap }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
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
    mockOrchestratePanelContentProps.length = 0
    mockOutputVarsProps.length = 0
    mockStoreState.appId = 'app-1'
    mockStoreState.openInlineAgentPanelNodeId = undefined
    mockCopyFromRosterState.isPending = false
    mockConfigsMap.flowId = 'app-1'
    mockConfigsMap.flowType = FlowType.appFlow
    mockCopyFromRosterMutate.mockImplementation(
      (
        _variables,
        options?: {
          onSuccess?: (composerState: {
            binding: {
              agent_id: string
              binding_type: 'inline_agent'
              current_snapshot_id: string
              id: string
              node_id: string
              workflow_id: string
            }
          }) => void
        },
      ) => {
        options?.onSuccess?.({
          binding: {
            id: 'binding-1',
            binding_type: 'inline_agent',
            agent_id: 'inline-copy-agent',
            current_snapshot_id: 'inline-copy-snapshot',
            workflow_id: 'workflow-1',
            node_id: 'agent-node',
          },
        })
      },
    )
    mockCreateInlineAgentBinding.mockImplementation(() => {})
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
    mockUseWorkflowInlineAgentDetail.mockImplementation(
      (nodeId?: string, agentId?: string | null) => ({
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
        isFetching: false,
        refetch: mockWorkflowInlineAgentDetailRefetch,
      }),
    )
  })

  it('renders selected roster agent trigger and default Agent v2 output vars', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    expect(screen.getByText('workflow.nodes.agent.roster.label')).toBeInTheDocument()
    expect(screen.getByText('Nadia')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.task.label')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.agent.task.tooltip' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' })).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.agent.advancedSetting' }),
    ).toBeInTheDocument()
    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(screen.queryByText('usage')).not.toBeInTheDocument()
    expect(screen.getByText('files')).toBeInTheDocument()
    expect(screen.getByText('array[file]')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.outputVars.files.title')).toBeInTheDocument()
    expect(screen.getByText('json')).toBeInTheDocument()
    expect(screen.getByText('object')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    ).toBeInTheDocument()
  })

  it('opens and closes the roster agent layered panel', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )

    const panel = screen.getByRole('dialog', { name: 'Nadia' })
    expect(panel).toBeInTheDocument()
    expect(within(panel).getByText('Researcher')).toBeInTheDocument()
    const consoleLink = within(panel).getByRole('link', {
      name: 'workflow.nodes.agent.roster.editInConsole',
    })
    expect(consoleLink).toHaveAttribute('href', '/agents/agent-1/configure')
    expect(consoleLink).toHaveAttribute('target', '_blank')
    expect(consoleLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      within(panel).getByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('region', { name: 'readonly-roster-orchestrate-panel' }),
    ).toBeInTheDocument()
    expect(mockOrchestratePanelContentProps.at(-1)).toMatchObject({
      agentId: 'agent-1',
      nodeId: 'agent-node',
      open: true,
    })

    fireEvent.keyDown(panel, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Nadia' })).not.toBeInTheDocument()
  })

  it('copies a roster agent from the drawer into an inline agent for this node', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' }))

    expect(mockCopyFromRosterMutate).toHaveBeenCalledWith(
      {
        params: {
          app_id: 'app-1',
          node_id: 'agent-node',
        },
        body: {
          source_agent_id: 'agent-1',
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    expect(mockStoreState.setOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('agent-node')
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-copy-agent',
            current_snapshot_id: 'inline-copy-snapshot',
          },
          _openInlineAgentPanel: true,
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('copies a roster agent through the snippet composer API', () => {
    mockConfigsMap.flowId = 'snippet-1'
    mockConfigsMap.flowType = FlowType.snippet
    mockStoreState.appId = undefined as never
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' }))

    expect(mockCopyFromRosterMutate).toHaveBeenCalledWith(
      {
        params: {
          snippet_id: 'snippet-1',
          node_id: 'agent-node',
        },
        body: {
          source_agent_id: 'agent-1',
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
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
    expect(screen.getByText('text')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
  })

  it('renders a pending inline agent state while the binding is being created', () => {
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    const { container } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          _isTempNode: true,
          agent_binding: {
            binding_type: 'inline_agent',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByText(/^workflow\.errorMsg\.fieldRequired/)).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.agent.roster.change', hidden: true }),
    ).toBeDisabled()
    expect(
      screen.getByRole('dialog', { name: 'workflow.nodes.agent.roster.inlineSetup.name' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'inline-orchestrate-panel' })).toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.agent.roster.editInConsole')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.agent.roster.makeCopy')).not.toBeInTheDocument()
    expect(mockOrchestratePanelContentProps.at(-1)).toMatchObject({
      agentId: undefined,
      nodeId: 'agent-node',
      open: true,
    })
    expect(screen.getByText('workflow.nodes.agent.task.label')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.outputVars.text')).toBeInTheDocument()
    expect(container.querySelector('[inert]')).toBeInTheDocument()
  })

  it('opens a pending inline agent modal and creates the inline agent before rendering details', () => {
    const { container, rerender } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
          },
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )

    expect(mockStoreState.setOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('agent-node')
    expect(mockCreateInlineAgentBinding).toHaveBeenCalledWith(
      'agent-node',
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    rerender(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'workflow.nodes.agent.roster.inlineSetup.name' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'inline-orchestrate-panel' })).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('renders inline agent detail from workflow composer state and opens the inline panel', () => {
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    const { container } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          _isTempNode: true,
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(mockUseAgentRosterDetail).toHaveBeenCalledWith(undefined)
    expect(mockUseWorkflowInlineAgentDetail).toHaveBeenCalledWith('agent-node', 'inline-agent-1')
    expect(screen.getByRole('dialog', { name: 'Workflow Agent 1' })).toBeInTheDocument()
    const trigger = screen.getByRole('button', {
      name: /^workflow\.nodes\.agent\.roster\.openPanel/,
      hidden: true,
    })
    expect(
      within(trigger).getByText('workflow.nodes.agent.roster.inlineSetup.name'),
    ).toBeInTheDocument()
    expect(
      within(trigger).getByText('workflow.nodes.agent.roster.inlineSetup.type'),
    ).toBeInTheDocument()
    const panel = screen.getByRole('dialog', { name: 'Workflow Agent 1' })
    expect(container.querySelector('.i-custom-vender-agent-v2-configure')).toHaveClass(
      'h-3.5',
      'w-3',
    )
    expect(
      container.querySelector('.i-custom-vender-agent-v2-configure')?.parentElement,
    ).toHaveClass('size-8', 'rounded-full', 'bg-background-default-burn')
    expect(
      screen.queryByText('workflow.nodes.agent.roster.inlineSetup.title'),
    ).not.toBeInTheDocument()
    expect(
      within(panel).getByText('workflow.nodes.agent.roster.inlineSetup.description'),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'inline-orchestrate-panel' })).toBeInTheDocument()
    expect(mockOrchestratePanelContentProps.at(-1)).toMatchObject({
      agentId: 'inline-agent-1',
      nodeId: 'agent-node',
      open: true,
    })
    expect(screen.queryByText('workflow.nodes.agent.roster.editInConsole')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.agent.roster.makeCopy')).not.toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.task.label')).toBeInTheDocument()
  })

  it('does not open copied inline agent configuration before its composer is created', () => {
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: mockWorkflowInlineAgentDetailRefetch,
    })

    const { container, rerender } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'source-inline-agent',
            current_snapshot_id: 'source-inline-snapshot',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /^workflow\.nodes\.agent\.roster\.openPanel/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      data: {
        agent: {
          id: 'cloned-inline-agent',
          name: 'Cloned Workflow Agent',
          description: '',
          scope: 'workflow_only',
          status: 'active',
        },
        binding: {
          binding_type: 'inline_agent',
          agent_id: 'cloned-inline-agent',
          current_snapshot_id: 'cloned-inline-snapshot',
        },
      },
      isFetching: false,
      refetch: mockWorkflowInlineAgentDetailRefetch,
    })
    rerender(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'source-inline-agent',
            current_snapshot_id: 'source-inline-snapshot',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Cloned Workflow Agent' })).toBeInTheDocument()
    expect(mockOrchestratePanelContentProps.at(-1)).toMatchObject({
      agentId: 'cloned-inline-agent',
      nodeId: 'agent-node',
      open: true,
    })
  })

  it('uses the detail header when opening an existing inline agent from the roster trigger', () => {
    const { rerender } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )
    expect(mockStoreState.setOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('agent-node')
    expect(mockWorkflowInlineAgentDetailRefetch).toHaveBeenCalled()

    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    rerender(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    const panel = screen.getByRole('dialog', { name: 'Workflow Agent 1' })
    expect(panel).toBeInTheDocument()
    expect(within(panel).getByText('Workflow Agent 1')).toBeInTheDocument()
    expect(
      within(panel).queryByText('workflow.nodes.agent.roster.inlineSetup.title'),
    ).not.toBeInTheDocument()
    expect(
      within(panel).getByText('workflow.nodes.agent.roster.inlineSetup.description'),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole('link', { name: 'workflow.nodes.agent.roster.editInConsole' }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: 'workflow.nodes.agent.roster.makeCopy' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'inline-orchestrate-panel' })).toBeInTheDocument()
  })

  it('keeps the inline roster trigger stable while opening refetches composer state', () => {
    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      data: {
        agent: {
          id: 'inline-agent-1',
          name: 'Workflow Agent 1',
          description: '',
          scope: 'workflow_only',
          status: 'active',
        },
      },
      isFetching: true,
      refetch: mockWorkflowInlineAgentDetailRefetch,
    })
    const { rerender } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /^workflow\.nodes\.agent\.roster\.openPanel/ }),
    )
    expect(mockWorkflowInlineAgentDetailRefetch).toHaveBeenCalled()

    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    rerender(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: /^workflow\.nodes\.agent\.roster\.openPanel/,
      hidden: true,
    })
    expect(trigger).not.toHaveAttribute('aria-busy')
    expect(
      within(trigger).getByText('workflow.nodes.agent.roster.inlineSetup.name'),
    ).toBeInTheDocument()
    expect(
      within(trigger).getByText('workflow.nodes.agent.roster.inlineSetup.type'),
    ).toBeInTheDocument()
    expect(mockOrchestratePanelContentProps.at(-1)).toMatchObject({
      agentId: 'inline-agent-1',
      inlineComposerState: expect.objectContaining({
        agent: expect.objectContaining({
          id: 'inline-agent-1',
        }),
      }),
      nodeId: 'agent-node',
      open: true,
    })
  })

  it('opens save-to-roster action from the inline workspace menu and rebinds to the saved roster agent', () => {
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    const panel = screen.getByRole('dialog', { name: 'Workflow Agent 1' })
    expect(
      within(panel).queryByRole('button', { name: 'workflow.nodes.agent.roster.more' }),
    ).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Inline workspace more' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Save inline agent to roster', hidden: true }),
    )

    expect(mockStoreState.setOpenInlineAgentPanelNodeId).toHaveBeenCalledWith(undefined)
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_binding: {
            binding_type: 'roster_agent',
            agent_id: 'saved-roster-agent',
          },
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('updates the inline binding snapshot from the inline workspace autosave response', () => {
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Autosave inline workspace' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'latest-snapshot-2',
          },
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
    expect(mockStoreState.setOpenInlineAgentPanelNodeId).not.toHaveBeenCalledWith(undefined)
  })

  it('does not show start from scratch for an existing inline agent binding', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.roster.change' }))

    expect(screen.queryByRole('button', { name: 'Start from Scratch' })).not.toBeInTheDocument()
  })

  it('keeps the inline panel closed while workflow composer state is still loading', () => {
    mockStoreState.openInlineAgentPanelNodeId = 'agent-node'
    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      data: undefined,
      isFetching: true,
      refetch: mockWorkflowInlineAgentDetailRefetch,
    })

    const { container } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(mockUseWorkflowInlineAgentDetail).toHaveBeenCalledWith('agent-node', 'inline-agent-1')
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /^workflow\.nodes\.agent\.roster\.openPanel/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'inline-orchestrate-panel' }),
    ).not.toBeInTheDocument()
  })

  it('shows a retry action when loading the inline agent composer fails', () => {
    mockUseWorkflowInlineAgentDetail.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      refetch: mockWorkflowInlineAgentDetailRefetch,
    })

    const { container } = render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'agentV2.roster.nodeSelector.createInlineFailed',
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(mockWorkflowInlineAgentDetailRefetch).toHaveBeenCalledTimes(1)
  })

  it('recovers the inline setup panel open state from the node open marker', () => {
    mockUseWorkflowInlineAgentDetail.mockReturnValue({ data: undefined })

    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          _openInlineAgentPanel: true,
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'snapshot-1',
          },
        })}
        panelProps={panelProps}
      />,
    )

    expect(mockStoreState.setOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('agent-node')
    expect(mockHandleNodeDataUpdate).toHaveBeenCalledWith({
      id: 'agent-node',
      data: {
        _openInlineAgentPanel: false,
      },
    })
  })

  it('updates roster agent binding from the selector', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

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

  it('switches a roster agent to a workflow-only inline agent from the selector', () => {
    mockCreateInlineAgentBinding.mockImplementation(
      (
        _nodeId: string,
        options?: {
          onSuccess?: (binding: {
            binding_type: 'inline_agent'
            agent_id: string
            current_snapshot_id: string
          }) => void
        },
      ) => {
        options?.onSuccess?.({
          binding_type: 'inline_agent',
          agent_id: 'inline-agent-1',
          current_snapshot_id: 'inline-snapshot-1',
        })
      },
    )

    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Keep this task',
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.roster.change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start from Scratch' }))

    expect(mockStoreState.setOpenInlineAgentPanelNodeId).toHaveBeenCalledWith('agent-node')
    expect(mockCreateInlineAgentBinding).toHaveBeenCalledWith(
      'agent-node',
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_binding: {
            binding_type: 'inline_agent',
          },
          agent_task: 'Keep this task',
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
            },
          ],
          _openInlineAgentPanel: true,
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_binding: {
            binding_type: 'inline_agent',
            agent_id: 'inline-agent-1',
            current_snapshot_id: 'inline-snapshot-1',
          },
          agent_task: 'Keep this task',
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
            },
          ],
          _openInlineAgentPanel: true,
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
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

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

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_task: 'Clarify {{#start.question#}}',
      }),
    )
    expect(mockPromptEditorProps[0]?.workflowVariableBlock).toMatchObject({
      show: true,
    })
    expect(mockPromptEditorProps[0]?.isSupportFileVar).toBe(true)
    expect(mockPromptEditorProps[0]?.agentOutputBlock).toMatchObject({
      show: true,
      outputs: expect.arrayContaining([expect.objectContaining({ name: 'text' })]),
      onEdit: expect.any(Function),
    })
    expect(mockPromptEditorProps[0]?.contextBlock).toBeUndefined()

    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.agent.task.insert' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.agent.task.mention' }),
    ).not.toBeInTheDocument()

    fireEvent.focus(editor)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.task.insert' }))
    expect(mockEditorFocus).toHaveBeenCalled()
    expect(mockInsertNodes.mock.calls[0]?.[0]?.[0]?.getTextContent()).toBe('/')
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.agent.task.mention' }),
    ).not.toBeInTheDocument()
  })

  it('opens the output variable editor from an agent task output token hover', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
              required: false,
              description: 'Short summary',
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    act(() => {
      mockPromptEditorProps[0]?.agentOutputBlock?.onEdit?.('summary', 'string')
    })

    expect(mockOutputVarsProps.at(-1)?.collapsed).toBe(false)
    expect(
      screen.getByRole('form', { name: 'workflow.nodes.agent.outputVars.editorLabel' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' }),
    ).toHaveValue('summary')
  })

  it('expands output variables when an agent task output token changes declared outputs', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    expect(mockOutputVarsProps.at(-1)?.collapsed).toBe(true)

    act(() => {
      mockPromptEditorProps[0]?.agentOutputBlock?.onChange?.(
        [
          {
            name: 'summary',
            type: 'string',
            required: false,
          },
        ],
        'Generate [§output:summary:summary§]',
      )
    })

    expect(mockOutputVarsProps.at(-1)?.collapsed).toBe(false)
  })

  it('opens the output variable editor for a prompt token missing from declared outputs', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    act(() => {
      mockPromptEditorProps[0]?.agentOutputBlock?.onEdit?.('qna_report', 'string')
    })

    expect(
      screen.getByRole('form', { name: 'workflow.nodes.agent.outputVars.editorLabel' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' }),
    ).toHaveValue('qna_report')

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.confirm' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({
              name: 'qna_report',
              type: 'string',
            }),
          ]),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('renames the current prompt output token instead of creating a separate output', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Generate [§output:qna_report:qna_report§]',
        })}
        panelProps={panelProps}
      />,
    )

    act(() => {
      mockPromptEditorProps[0]?.agentOutputBlock?.onEdit?.('qna_report', 'string')
    })

    fireEvent.change(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' }),
      {
        target: {
          value: 'final_report',
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.confirm' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_task: 'Generate [§output:final_report:final_report§]',
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({
              name: 'final_report',
              type: 'string',
            }),
          ]),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
    const updatedData = mockHandleNodeDataUpdateWithSyncDraft.mock.calls.at(-1)?.[0]
      .data as AgentV2NodeType
    expect(updatedData.agent_declared_outputs?.some((output) => output.name === 'qna_report')).toBe(
      false,
    )
    expect(screen.getByText('final_report')).toBeInTheDocument()
  })

  it('reconciles inline prompt output renames with the existing declared output row', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Generate [§output:qna_report:qna_report§]',
          agent_declared_outputs: [
            {
              name: 'qna_report',
              type: 'string',
              required: false,
              description: 'Old report',
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    act(() => {
      mockPromptEditorProps[0]?.agentOutputBlock?.onChange?.(
        [
          {
            name: 'qna_report',
            type: 'string',
            required: false,
            description: 'Old report',
          },
          {
            name: 'final_report',
            type: 'string',
            required: false,
          },
        ],
        'Generate [§output:final_report:final_report§]',
      )
    })

    const updatedData = mockHandleNodeDataUpdateWithSyncDraft.mock.calls.at(-1)?.[0]
      .data as AgentV2NodeType
    expect(updatedData.agent_task).toBe('Generate [§output:final_report:final_report§]')
    expect(updatedData.agent_declared_outputs).toEqual([
      expect.objectContaining({
        name: 'final_report',
        type: 'string',
      }),
    ])
    expect(screen.getByText('final_report')).toBeInTheDocument()
  })

  it('keeps output variables synced when prompt text rename arrives before output block data', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Generate [§output:qna_report:qna_report§]',
          agent_declared_outputs: [
            {
              name: 'qna_report',
              type: 'string',
              required: false,
              description: 'Old report',
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    act(() => {
      mockPromptEditorProps[0]?.onChange?.('Generate [§output:final_report:final_report§]')
    })

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_task: 'Generate [§output:final_report:final_report§]',
        agent_declared_outputs: [
          expect.objectContaining({
            name: 'final_report',
            type: 'string',
            description: 'Old report',
          }),
        ],
      }),
    )
    expect(screen.getByText('final_report')).toBeInTheDocument()
  })

  it('syncs declared outputs created from the agent task editor', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    mockPromptEditorProps[0]?.agentOutputBlock?.onChange?.(
      [
        ...mockPromptEditorProps[0]!.agentOutputBlock!.outputs!,
        {
          name: 'summary',
          type: 'string',
          required: false,
        },
      ],
      'Use [§output:summary:summary§]',
    )

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_task: 'Use [§output:summary:summary§]',
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({
              name: 'summary',
              type: 'string',
              required: false,
            }),
          ]),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('keeps the latest local task draft when outputs change before rerender', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' }), {
      target: {
        value: 'Draft before output',
      },
    })
    mockPromptEditorProps[0]?.agentOutputBlock?.onChange?.([
      ...mockPromptEditorProps[0]!.agentOutputBlock!.outputs!,
      {
        name: 'summary',
        type: 'string',
        required: false,
      },
    ])

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_task: 'Draft before output',
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({
              name: 'summary',
              type: 'string',
              required: false,
            }),
          ]),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('saves agent task to workflow draft node data', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' }), {
      target: {
        value: 'Use the previous result',
      },
    })

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_task: 'Use the previous result',
      }),
    )
  })

  it('removes declared outputs when their prompt output token is deleted', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Use [§output:summary:summary§] and [§output:manual:manual§]',
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
              required: false,
            },
            {
              name: 'manual',
              type: 'string',
              required: false,
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'workflow.nodes.agent.task.label' }), {
      target: {
        value: 'Use [§output:manual:manual§]',
      },
    })

    expect(mockSetInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_task: 'Use [§output:manual:manual§]',
        agent_declared_outputs: [
          expect.objectContaining({
            name: 'manual',
          }),
        ],
      }),
    )
  })

  it('does not remove prompt output tokens when declared outputs are changed from the output list', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Use [§output:summary:summary§]',
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
              required: false,
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    mockPromptEditorProps[0]?.agentOutputBlock?.onChange?.([])

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_task: 'Use [§output:summary:summary§]',
          agent_declared_outputs: [],
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('renames prompt output tokens when a referenced declared output is renamed from the output list', () => {
    render(
      <AgentV2Panel
        id="agent-node"
        data={createData({
          agent_task: 'Use [§output:summary:summary§] and §output:other:other§',
          agent_declared_outputs: [
            {
              name: 'summary',
              type: 'string',
              required: false,
            },
            {
              name: 'other',
              type: 'string',
              required: false,
            },
          ],
        })}
        panelProps={panelProps}
      />,
    )

    mockPromptEditorProps[0]?.agentOutputBlock?.onChange?.([
      {
        name: 'final_summary',
        type: 'string',
        required: false,
      },
      {
        name: 'other',
        type: 'string',
        required: false,
      },
    ])

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_task: 'Use [§output:final_summary:final_summary§] and §output:other:other§',
          agent_declared_outputs: [
            expect.objectContaining({
              name: 'final_summary',
            }),
            expect.objectContaining({
              name: 'other',
            }),
          ],
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
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

    expect(screen.getByText('summary')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.getByText('Short summary')).toBeInTheDocument()
    expect(screen.getByText('attachments')).toBeInTheDocument()
    expect(screen.getByText('array[file]')).toBeInTheDocument()
    expect(screen.getByText('Generated files')).toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.agent.outputVars.text')).not.toBeInTheDocument()
  })

  it('adds a declared output to workflow draft node data', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' }),
      {
        target: {
          value: 'summary',
        },
      },
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.descriptionLabel' }),
      {
        target: {
          value: 'Short summary',
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.confirm' }))

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({
              name: 'summary',
              type: 'string',
              required: false,
              description: 'Short summary',
            }),
          ]),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('submits the output editor with a scoped Mod+Enter shortcut', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    )
    const nameInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.agent.outputVars.nameLabel',
    })
    fireEvent.change(nameInput, {
      target: {
        value: 'summary',
      },
    })
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    expect(mockHandleNodeDataUpdateWithSyncDraft).not.toHaveBeenCalled()

    fireEvent.keyDown(nameInput, { key: 'Enter', ctrlKey: true })

    expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith(
      {
        id: 'agent-node',
        data: expect.objectContaining({
          agent_declared_outputs: expect.arrayContaining([
            expect.objectContaining({
              name: 'summary',
            }),
          ]),
        }),
      },
      expect.objectContaining({
        sync: true,
        notRefreshWhenSyncError: true,
      }),
    )
  })

  it('cancels the output editor with a scoped Escape shortcut', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    )
    const nameInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.agent.outputVars.nameLabel',
    })
    fireEvent.change(nameInput, {
      target: {
        value: 'summary',
      },
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' }),
    ).toBeInTheDocument()

    fireEvent.keyDown(nameInput, { key: 'Escape' })

    expect(
      screen.queryByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    ).toBeInTheDocument()
    expect(mockHandleNodeDataUpdateWithSyncDraft).not.toHaveBeenCalled()
  })

  it('reveals output editor advanced options with the collapsible trigger', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    )

    expect(
      screen.queryByRole('textbox', { name: 'workflow.nodes.agent.outputVars.defaultValueLabel' }),
    ).not.toBeInTheDocument()

    const advancedTrigger = screen.getByRole('button', {
      name: 'workflow.nodes.agent.outputVars.showAdvancedOptions',
    })
    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(advancedTrigger)

    expect(advancedTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.defaultValueLabel' }),
    ).toBeInTheDocument()
  })

  it('does not show name validation error before the user enters a name', () => {
    render(<AgentV2Panel id="agent-node" data={createData()} panelProps={panelProps} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    )

    expect(
      screen.queryByText('workflow.nodes.agent.outputVars.nameInvalid'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.confirm' }),
    ).toBeDisabled()
  })
})
