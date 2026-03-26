import { fireEvent, render, screen } from '@testing-library/react'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum, EditionType, PromptRole } from '@/app/components/workflow/types'
import {
  getSubGraphUserPromptText,
  resolveSubGraphAssembleOutputSelector,
  resolveSubGraphPromptText,
} from '../helpers'
import SubGraphModal from '../index'

const {
  mockSubGraphCanvas,
  mockSetNodes,
  mockSetControlPromptEditorRerenderKey,
  mockHandleSyncWorkflowDraft,
  mockDoSyncWorkflowDraft,
  mockGetBeforeNodesInSameBranch,
  mockGetNodeAvailableVars,
} = vi.hoisted(() => ({
  mockSubGraphCanvas: vi.fn(),
  mockSetNodes: vi.fn(),
  mockSetControlPromptEditorRerenderKey: vi.fn(),
  mockHandleSyncWorkflowDraft: vi.fn(),
  mockDoSyncWorkflowDraft: vi.fn(),
  mockGetBeforeNodesInSameBranch: vi.fn(),
  mockGetNodeAvailableVars: vi.fn(),
}))

let workflowNodes = [
  {
    id: 'tool-node',
    data: {
      type: BlockEnum.Tool,
      tool_parameters: {
        query: {
          value: '',
          type: VarKindType.mixed,
        },
      },
    },
  },
  {
    id: 'tool-node_ext_query',
    data: {
      type: BlockEnum.LLM,
      prompt_template: [{ role: PromptRole.user, text: 'existing prompt' }],
    },
  },
] as Array<Record<string, unknown>>
let mockSavedSubGraphNodes: Array<Record<string, unknown>> | null = null

vi.mock('@headlessui/react', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Transition: ({ children, show }: { children: React.ReactNode, show: boolean }) => show ? <div>{children}</div> : null,
  TransitionChild: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => workflowNodes,
      setNodes: (nextNodes: typeof workflowNodes) => {
        workflowNodes = nextNodes
      },
    }),
  }),
  useStore: (selector: (state: { edges: unknown[] }) => unknown) => selector({ edges: [] }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    nodes: typeof workflowNodes
    setNodes: typeof mockSetNodes
    setControlPromptEditorRerenderKey: typeof mockSetControlPromptEditorRerenderKey
  }) => unknown) => selector({
    nodes: workflowNodes,
    setNodes: mockSetNodes,
    setControlPromptEditorRerenderKey: mockSetControlPromptEditorRerenderKey,
  }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowId: string } }) => unknown) => selector({
    configsMap: { flowId: 'flow-1' },
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    doSyncWorkflowDraft: mockDoSyncWorkflowDraft,
  }),
  useWorkflow: () => ({
    getBeforeNodesInSameBranch: mockGetBeforeNodesInSameBranch,
  }),
  useWorkflowVariables: () => ({
    getNodeAvailableVars: mockGetNodeAvailableVars,
  }),
  useIsChatMode: () => false,
}))

vi.mock('../sub-graph-canvas', () => ({
  __esModule: true,
  default: (props: {
    variant: string
    onSave?: (nodes: Array<Record<string, unknown>>) => void
    onNestedNodeConfigChange?: (config: { extractor_node_id: string, output_selector: string[], null_strategy: string, default_value: string }) => void
  }) => {
    mockSubGraphCanvas(props)
    const savedNodes = mockSavedSubGraphNodes ?? [
      {
        id: 'tool-node_ext_query',
        data: props.variant === 'agent'
          ? {
              type: BlockEnum.LLM,
              prompt_template: [{ role: PromptRole.user, text: 'updated prompt' }],
            }
          : {
              type: BlockEnum.Code,
              outputs: {
                result: {
                  type: 'string',
                  children: null,
                },
              },
            },
      },
    ]
    return (
      <div data-testid={`sub-graph-canvas-${String(props.variant)}`}>
        <button
          type="button"
          onClick={() => props.onSave?.(savedNodes)}
        >
          save-sub-graph
        </button>
        <button
          type="button"
          onClick={() => props.onNestedNodeConfigChange?.({
            extractor_node_id: 'tool-node_ext_query',
            output_selector: ['result'],
            null_strategy: 'raise-error',
            default_value: '',
          })}
        >
          change-nested-config
        </button>
      </div>
    )
  },
}))

describe('SubGraphModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSavedSubGraphNodes = null
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '',
              type: VarKindType.mixed,
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.LLM,
          prompt_template: [{ role: PromptRole.user, text: 'existing prompt' }],
        },
      },
    ] as Array<Record<string, unknown>>
    mockGetBeforeNodesInSameBranch.mockReturnValue([{ id: 'start-node', data: { title: 'Start', type: BlockEnum.Start } }])
    mockGetNodeAvailableVars.mockReturnValue([{ nodeId: 'start-node', title: 'Start', vars: [] }])
  })

  it('should normalize prompt and selector helper fallbacks', () => {
    expect(resolveSubGraphPromptText()).toBe('')
    expect(resolveSubGraphPromptText({
      role: PromptRole.user,
      text: '',
      jinja2_text: '',
      edition_type: EditionType.jinja2,
    })).toBe('')
    expect(getSubGraphUserPromptText()).toBe('')
    expect(resolveSubGraphAssembleOutputSelector('fallback', ['fallback'], 'tool-node_ext_query')).toEqual(['fallback'])
    expect(resolveSubGraphAssembleOutputSelector(['tool-node_ext_query', 'fallback'], ['fallback'], 'tool-node_ext_query')).toBeNull()
  })

  it('should render nothing when the modal is closed', () => {
    render(
      <SubGraphModal
        isOpen={false}
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    expect(screen.queryByTestId('sub-graph-canvas-assemble')).not.toBeInTheDocument()
  })

  it('should render the agent variant and forward agent-specific props to the sub graph canvas', () => {
    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="agent"
        toolNodeId="tool-node"
        paramKey="query"
        sourceVariable={['agent-1', 'context']}
        agentName="Agent One"
        agentNodeId="agent-1"
        pendingSingleRun
        onPendingSingleRunHandled={vi.fn()}
      />,
    )

    expect(screen.getByText(/@Agent One/)).toBeInTheDocument()
    expect(screen.getByTestId('sub-graph-canvas-agent')).toBeInTheDocument()
    expect(mockSubGraphCanvas).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'agent',
      sourceVariable: ['agent-1', 'context'],
      pendingSingleRun: true,
      nestedNodeConfig: expect.objectContaining({
        output_selector: ['structured_output', 'query'],
      }),
    }))
  })

  it('should render the assemble variant and persist saved extractor output back to the tool node', () => {
    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    const savedToolNode = workflowNodes.find(node => node.id === 'tool-node') as {
      data: {
        tool_parameters: {
          query: {
            value: string
            type: VarKindType
          }
        }
      }
    } | undefined
    const savedExtractorNode = workflowNodes.find(node => node.id === 'tool-node_ext_query') as {
      hidden?: boolean
    } | undefined

    expect(screen.getByText(/Assemble variables/)).toBeInTheDocument()
    expect(screen.getByTestId('sub-graph-canvas-assemble')).toBeInTheDocument()
    expect(savedToolNode?.data.tool_parameters.query.value).toBe('{{#tool-node_ext_query.result#}}')
    expect(savedToolNode?.data.tool_parameters.query.type).toBe(VarKindType.nested_node)
    expect(savedExtractorNode?.hidden).toBe(true)
    expect(mockSetNodes).toHaveBeenCalled()
    expect(mockSetControlPromptEditorRerenderKey).toHaveBeenCalled()
  }, 15000)

  it('should normalize missing nested node config when the tool parameter already uses nested-node mode', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {},
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            result: {
              type: 'string',
              children: null,
            },
          },
        },
      },
    ] as Array<Record<string, unknown>>

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    const normalizedToolNode = workflowNodes.find(node => node.id === 'tool-node') as {
      data: {
        tool_parameters: {
          query: {
            nested_node_config: {
              extractor_node_id: string
              output_selector: string[]
              default_value: string
            }
          }
        }
      }
    }

    expect(normalizedToolNode.data.tool_parameters.query.nested_node_config).toEqual(expect.objectContaining({
      extractor_node_id: 'tool-node_ext_query',
      output_selector: ['result'],
      default_value: '',
    }))
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
  })

  it('should save agent sub-graphs back into the tool parameter and close from the header button', () => {
    const onClose = vi.fn()

    render(
      <SubGraphModal
        isOpen
        onClose={onClose}
        variant="agent"
        toolNodeId="tool-node"
        paramKey="query"
        sourceVariable={['agent-1', 'context']}
        agentName="Agent One"
        agentNodeId="agent-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))
    fireEvent.click(screen.getAllByRole('button')[0]!)

    const savedToolNode = workflowNodes.find(node => node.id === 'tool-node') as {
      data: {
        tool_parameters: {
          query: {
            value: string
            type: VarKindType
          }
        }
      }
    } | undefined

    expect(savedToolNode?.data.tool_parameters.query.value).toBe('{{@agent-1.context@}}updated prompt')
    expect(savedToolNode?.data.tool_parameters.query.type).toBe(VarKindType.nested_node)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should fall back to the first assemble output key when result is unavailable', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {
                extractor_node_id: 'tool-node_ext_query',
                output_selector: ['missing'],
                null_strategy: 'raise-error',
                default_value: '',
              },
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            fallback: {
              type: 'string',
              children: null,
            },
          },
        },
      },
    ] as Array<Record<string, unknown>>

    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
        outputs: {
          fallback: {
            type: 'string',
            children: null,
          },
        },
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    const savedToolNode = workflowNodes.find(node => node.id === 'tool-node') as {
      data: {
        tool_parameters: {
          query: {
            nested_node_config: {
              output_selector: string[]
            }
          }
        }
      }
    }

    expect(savedToolNode.data.tool_parameters.query.nested_node_config.output_selector).toEqual(['fallback'])
  })

  it('should fall back to the default assemble title and normalize prefixed selectors before passing them to the canvas', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {
                extractor_node_id: 'tool-node_ext_query',
                output_selector: ['tool-node_ext_query', 'result'],
                null_strategy: 'raise-error',
                default_value: '',
              },
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            result: {
              type: 'string',
              children: null,
            },
          },
        },
      },
    ] as Array<Record<string, unknown>>

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title=""
      />,
    )

    expect(screen.getByText(/workflow\.nodes\.tool\.assembleVariables/)).toBeInTheDocument()
    expect(mockSubGraphCanvas).toHaveBeenCalledWith(expect.objectContaining({
      nestedNodeConfig: expect.objectContaining({
        output_selector: ['result'],
      }),
    }))
  })

  it('should ignore nested config changes and save attempts when the tool parameter or extractor node is missing', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {},
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {},
        },
      },
    ] as Array<Record<string, unknown>>
    mockSavedSubGraphNodes = [{
      id: 'other-node',
      data: {
        type: BlockEnum.Code,
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    const snapshot = JSON.stringify(workflowNodes)
    fireEvent.click(screen.getByRole('button', { name: 'change-nested-config' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    expect(JSON.stringify(workflowNodes)).toBe(snapshot)
  })

  it('should save agent variants with placeholder-only prompts when no user prompt is present', () => {
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [{ role: PromptRole.assistant, text: 'assistant only' }],
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="agent"
        toolNodeId="tool-node"
        paramKey="query"
        sourceVariable={['agent-1', 'context']}
        agentName="Agent One"
        agentNodeId="agent-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    const savedToolNode = workflowNodes.find(node => node.id === 'tool-node') as {
      data: {
        tool_parameters: {
          query: {
            value: string
          }
        }
      }
    }

    expect(savedToolNode.data.tool_parameters.query.value).toBe('{{@agent-1.context@}}')
  })

  it('should save agent variants with placeholder-only prompts when the extractor prompt template is missing', () => {
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="agent"
        toolNodeId="tool-node"
        paramKey="query"
        sourceVariable={['agent-1', 'context']}
        agentName="Agent One"
        agentNodeId="agent-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    expect((workflowNodes.find(node => node.id === 'tool-node') as {
      data: { tool_parameters: { query: { value: string } } }
    }).data.tool_parameters.query.value).toBe('{{@agent-1.context@}}')
  })

  it('should inject default assemble outputs when the saved graph does not define any', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {
                extractor_node_id: 'tool-node_ext_query',
                output_selector: ['result'],
                null_strategy: 'raise-error',
                default_value: '',
              },
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {},
        },
      },
    ] as Array<Record<string, unknown>>
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
        outputs: {},
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    const savedExtractorNode = workflowNodes.find(node => node.id === 'tool-node_ext_query') as {
      data: {
        outputs: Record<string, unknown>
      }
    }

    expect(savedExtractorNode.data.outputs).toEqual({
      result: {
        type: 'string',
        children: null,
      },
    })
  })

  it('should inject default assemble outputs when the saved graph omits the outputs map entirely', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {
                extractor_node_id: 'tool-node_ext_query',
                output_selector: ['result'],
                null_strategy: 'raise-error',
                default_value: '',
              },
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
        },
      },
    ] as Array<Record<string, unknown>>
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    expect((workflowNodes.find(node => node.id === 'tool-node_ext_query') as {
      data: { outputs: Record<string, unknown> }
    }).data.outputs).toEqual({
      result: {
        type: 'string',
        children: null,
      },
    })
  })

  it('should handle array prompt templates without user items and jinja prompt fallbacks for agents', () => {
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: [{ role: PromptRole.assistant, text: 'assistant only' }],
      },
    }]

    const { rerender } = render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="agent"
        toolNodeId="tool-node"
        paramKey="query"
        sourceVariable={['agent-1', 'context']}
        agentName="Agent One"
        agentNodeId="agent-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))
    expect((workflowNodes.find(node => node.id === 'tool-node') as {
      data: { tool_parameters: { query: { value: string } } }
    }).data.tool_parameters.query.value).toBe('{{@agent-1.context@}}')

    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.LLM,
        prompt_template: {
          role: PromptRole.user,
          text: 'fallback prompt',
          jinja2_text: '',
          edition_type: EditionType.jinja2,
        },
      },
    }]

    rerender(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="agent"
        toolNodeId="tool-node"
        paramKey="query"
        sourceVariable={['agent-1', 'context']}
        agentName="Agent One"
        agentNodeId="agent-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))
    expect((workflowNodes.find(node => node.id === 'tool-node') as {
      data: { tool_parameters: { query: { value: string } } }
    }).data.tool_parameters.query.value).toBe('{{@agent-1.context@}}fallback prompt')
  })

  it('should normalize assemble selectors with prefixed ids and missing extractor ids', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {
                extractor_node_id: '',
                output_selector: ['tool-node_ext_query', 'fallback'],
                null_strategy: 'raise-error',
                default_value: '',
              },
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            fallback: {
              type: 'string',
              children: null,
            },
          },
        },
      },
      {
        id: 'other-node',
        data: {
          type: BlockEnum.Code,
        },
      },
    ] as Array<Record<string, unknown>>
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
        outputs: {
          fallback: {
            type: 'string',
            children: null,
          },
        },
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    expect((workflowNodes.find(node => node.id === 'tool-node') as {
      data: { tool_parameters: { query: { nested_node_config: { extractor_node_id: string, output_selector: string[] } } } }
    }).data.tool_parameters.query.nested_node_config).toEqual(expect.objectContaining({
      extractor_node_id: 'tool-node_ext_query',
      output_selector: ['fallback'],
    }))
  })

  it('should normalize non-array assemble selectors through the save flow', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {
            query: {
              value: '{{#tool-node_ext_query.result#}}',
              type: VarKindType.nested_node,
              nested_node_config: {
                extractor_node_id: '',
                output_selector: 'fallback',
                null_strategy: 'raise-error',
                default_value: '',
              },
            },
          },
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            fallback: {
              type: 'string',
              children: null,
            },
          },
        },
      },
    ] as Array<Record<string, unknown>>
    mockSavedSubGraphNodes = [{
      id: 'tool-node_ext_query',
      data: {
        type: BlockEnum.Code,
        outputs: {
          fallback: {
            type: 'string',
            children: null,
          },
        },
      },
    }]

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    expect((workflowNodes.find(node => node.id === 'tool-node') as {
      data: { tool_parameters: { query: { nested_node_config: { extractor_node_id: string, output_selector: string[] } } } }
    }).data.tool_parameters.query.nested_node_config).toEqual(expect.objectContaining({
      extractor_node_id: 'tool-node_ext_query',
      output_selector: ['fallback'],
    }))
  })

  it('should keep tool nodes unchanged when the target parameter is missing during save', () => {
    workflowNodes = [
      {
        id: 'tool-node',
        data: {
          type: BlockEnum.Tool,
          tool_parameters: {},
        },
      },
      {
        id: 'tool-node_ext_query',
        data: {
          type: BlockEnum.Code,
          outputs: {
            result: {
              type: 'string',
              children: null,
            },
          },
        },
      },
    ] as Array<Record<string, unknown>>

    render(
      <SubGraphModal
        isOpen
        onClose={vi.fn()}
        variant="assemble"
        toolNodeId="tool-node"
        paramKey="query"
        title="Assemble variables"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'save-sub-graph' }))

    expect((workflowNodes.find(node => node.id === 'tool-node') as {
      data: { tool_parameters: Record<string, unknown> }
    }).data.tool_parameters).toEqual({})
  })
})
