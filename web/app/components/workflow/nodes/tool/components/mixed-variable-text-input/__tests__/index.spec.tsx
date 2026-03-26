import type { AgentNode } from '@/app/components/base/prompt-editor/types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { useState } from 'react'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import MixedVariableTextInput from '../index'

const {
  mockPromptEditor,
  mockEnsureExtractorNode,
  mockEnsureAssembleExtractorNode,
  mockAssembleExtractorNodeId,
  mockRemoveExtractorNode,
  mockSyncExtractorPromptFromText,
  mockRequestNestedNodeGraph,
  mockOnOpenContextGenerateModal,
  mockSetControlPromptEditorRerenderKey,
  mockClearContextGenStorage,
} = vi.hoisted(() => ({
  mockPromptEditor: vi.fn(),
  mockEnsureExtractorNode: vi.fn(),
  mockEnsureAssembleExtractorNode: vi.fn(() => 'tool-node_ext_query'),
  mockAssembleExtractorNodeId: { value: 'tool-node_ext_query' },
  mockRemoveExtractorNode: vi.fn(),
  mockSyncExtractorPromptFromText: vi.fn(),
  mockRequestNestedNodeGraph: vi.fn(),
  mockOnOpenContextGenerateModal: vi.fn(),
  mockSetControlPromptEditorRerenderKey: vi.fn(),
  mockClearContextGenStorage: vi.fn(),
}))

let reactFlowNodes: Array<{ id: string, data: Record<string, unknown> }> = []
let mockStrategyProviders: Array<Record<string, unknown>> = []
let mockNodesMetaDataMap: Record<string, { defaultValue?: Record<string, unknown>, checkValid?: ReturnType<typeof vi.fn> }> = {}

vi.mock('@/service/use-strategy', () => ({
  useStrategyProviders: () => ({ data: mockStrategyProviders }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesMetaData: () => ({
    nodesMap: mockNodesMetaDataMap,
  }),
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowId: string } }) => unknown) => selector({
    configsMap: { flowId: 'flow-1' },
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    controlPromptEditorRerenderKey: number
    setControlPromptEditorRerenderKey: typeof mockSetControlPromptEditorRerenderKey
    nodesDefaultConfigs: Record<string, unknown>
  }) => unknown) => selector({
    controlPromptEditorRerenderKey: 1,
    setControlPromptEditorRerenderKey: mockSetControlPromptEditorRerenderKey,
    nodesDefaultConfigs: {},
  }),
}))

vi.mock('reactflow', () => ({
  useNodes: () => reactFlowNodes,
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => reactFlowNodes,
    }),
  }),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    value: string
    onChange: (value: string) => void
    workflowVariableBlock: {
      onSelectAgent?: (agent: AgentNode) => void
      onAssembleVariables?: () => void
      show?: boolean
    }
    editable?: boolean
  }) => {
    mockPromptEditor(props)
    return (
      <div>
        <div data-testid="prompt-value">{props.value}</div>
        <button type="button" onClick={() => props.workflowVariableBlock.onSelectAgent?.({ id: 'agent-1', title: 'Agent One' })}>
          select-agent
        </button>
        <button type="button" onClick={() => props.workflowVariableBlock.onAssembleVariables?.()}>
          select-assemble
        </button>
        <button type="button" onClick={() => props.onChange('plain text')}>
          change-text
        </button>
        <button type="button" onClick={() => props.onChange('{{@agent-1.context@}}updated prompt')}>
          change-agent-text
        </button>
      </div>
    )
  },
}))

vi.mock('../../context-generate-modal/utils/storage', async () => {
  const actual = await vi.importActual<typeof import('../../context-generate-modal/utils/storage')>('../../context-generate-modal/utils/storage')
  return {
    ...actual,
    clearContextGenStorage: (...args: unknown[]) => mockClearContextGenStorage(...args),
  }
})

vi.mock('../../context-generate-modal', () => ({
  __esModule: true,
  default: React.forwardRef((props: { isShow: boolean, onOpen?: () => void, onClose?: () => void, onOpenInternalViewAndRun?: () => void }, ref: React.Ref<{ onOpen: () => void }>) => {
    React.useImperativeHandle(ref, () => ({
      onOpen: () => mockOnOpenContextGenerateModal(),
    }))
    return props.isShow
      ? (
          <div data-testid="context-generate-modal">
            <button type="button" onClick={() => props.onOpenInternalViewAndRun?.()}>context-run-internal</button>
            <button type="button" onClick={() => props.onClose?.()}>context-close</button>
          </div>
        )
      : null
  }),
}))

vi.mock('../../sub-graph-modal', () => ({
  __esModule: true,
  default: ({
    variant,
    isOpen,
    onClose,
    onPendingSingleRunHandled,
  }: {
    variant: string
    isOpen: boolean
    onClose?: () => void
    onPendingSingleRunHandled?: () => void
  }) => (
    isOpen
      ? (
          <div data-testid={`sub-graph-${variant}`}>
            <button type="button" onClick={() => onClose?.()}>close-sub-graph</button>
            <button type="button" onClick={() => onPendingSingleRunHandled?.()}>handled-sub-graph</button>
          </div>
        )
      : null
  ),
}))

vi.mock('../components', () => ({
  AgentHeaderBar: ({
    agentName,
    onRemove,
    onViewInternals,
    hasWarning,
  }: {
    agentName: string
    onRemove: () => void
    onViewInternals?: () => void
    hasWarning?: boolean
  }) => (
    <div>
      <span>{agentName}</span>
      <span>{hasWarning ? 'warning-on' : 'warning-off'}</span>
      <button type="button" onClick={onRemove}>remove-header</button>
      {onViewInternals && <button type="button" onClick={onViewInternals}>view-header</button>}
    </div>
  ),
  Placeholder: () => <div data-testid="placeholder" />,
}))

vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useMixedVariableExtractor: () => ({
      assembleExtractorNodeId: mockAssembleExtractorNodeId.value,
      ensureExtractorNode: mockEnsureExtractorNode,
      ensureAssembleExtractorNode: mockEnsureAssembleExtractorNode,
      removeExtractorNode: mockRemoveExtractorNode,
      syncExtractorPromptFromText: mockSyncExtractorPromptFromText,
      requestNestedNodeGraph: mockRequestNestedNodeGraph,
    }),
  }
})

const availableNodes = [
  {
    id: 'agent-1',
    position: { x: 0, y: 0 },
    data: {
      title: 'Agent One',
      type: BlockEnum.Agent,
      height: 120,
      width: 240,
      position: { x: 0, y: 0 },
    },
  },
] as unknown as Node[]

const nodesOutputVars: NodeOutPutVar[] = []

const renderMixedInput = (overrides: Partial<React.ComponentProps<typeof MixedVariableTextInput>> = {}) => {
  const onChange = vi.fn()
  reactFlowNodes = [
    ...availableNodes,
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
    } as unknown as { id: string, data: Record<string, unknown> },
  ]

  const props: React.ComponentProps<typeof MixedVariableTextInput> = {
    value: '',
    onChange,
    toolNodeId: 'tool-node',
    paramKey: 'query',
    availableNodes,
    nodesOutputVars,
    ...overrides,
  }

  return {
    ...render(<MixedVariableTextInput {...props} />),
    onChange,
  }
}

describe('MixedVariableTextInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockAssembleExtractorNodeId.value = 'tool-node_ext_query'
    mockStrategyProviders = []
    mockNodesMetaDataMap = {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should insert agent context through the slash workflow variable block', () => {
    const { onChange } = renderMixedInput()

    fireEvent.click(screen.getByRole('button', { name: 'select-agent' }))

    expect(mockEnsureExtractorNode).toHaveBeenCalledWith(expect.objectContaining({
      extractorNodeId: 'tool-node_ext_query',
      nodeType: BlockEnum.LLM,
    }))
    expect(onChange).toHaveBeenCalledWith(
      '{{@agent-1.context@}}',
      VarKindType.nested_node,
      expect.objectContaining({
        extractor_node_id: 'tool-node_ext_query',
        output_selector: ['structured_output', 'query'],
      }),
    )
    expect(mockSyncExtractorPromptFromText).toHaveBeenCalledWith('{{@agent-1.context@}}', expect.any(Function))
    expect(mockRequestNestedNodeGraph).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      extractorNodeId: 'tool-node_ext_query',
      valueText: '{{@agent-1.context@}}',
    }))
  }, 15000)

  it('should switch assemble selections into the context generate flow', () => {
    const { onChange } = renderMixedInput()

    fireEvent.click(screen.getByRole('button', { name: 'select-assemble' }))

    act(() => {
      vi.runAllTimers()
    })

    expect(mockEnsureAssembleExtractorNode).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(
      '{{#tool-node_ext_query.result#}}',
      VarKindType.nested_node,
      expect.objectContaining({
        extractor_node_id: 'tool-node_ext_query',
        output_selector: ['result'],
      }),
    )
    expect(screen.getByTestId('context-generate-modal')).toBeInTheDocument()
    expect(mockOnOpenContextGenerateModal).toHaveBeenCalledTimes(1)
  })

  it('should remove the extractor node when plain text clears an agent context value', () => {
    const { onChange } = renderMixedInput({
      value: '{{@agent-1.context@}}prompt body',
    })

    fireEvent.click(screen.getByRole('button', { name: 'change-text' }))

    expect(mockRemoveExtractorNode).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('plain text', VarKindType.mixed, null)
  })

  it('should open the assemble sub graph when the header action is triggered', () => {
    renderMixedInput({
      value: '{{#tool-node_ext_query.result#}}',
    })

    fireEvent.click(screen.getByRole('button', { name: 'view-header' }))

    expect(screen.getByTestId('sub-graph-assemble')).toBeInTheDocument()
  })

  it('should remove agent and assemble header selections and clear persisted context data', () => {
    const { onChange, unmount } = renderMixedInput({
      value: '{{@agent-1.context@}}',
    })

    fireEvent.click(screen.getByRole('button', { name: 'remove-header' }))

    expect(mockRemoveExtractorNode).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('', VarKindType.mixed, null)

    unmount()
    renderMixedInput({
      value: '{{#tool-node_ext_query.result#}}',
    })

    fireEvent.click(screen.getByRole('button', { name: 'remove-header' }))

    expect(mockClearContextGenStorage).toHaveBeenCalledWith('flow-1-tool-node-query')
  })

  it('should sync extractor prompts for updated agent text and show the inline agent placeholder', () => {
    const { onChange } = renderMixedInput({
      value: '{{@agent-1.context@}}',
    })

    fireEvent.click(screen.getByRole('button', { name: 'change-agent-text' }))

    expect(mockSyncExtractorPromptFromText).toHaveBeenCalledWith('{{@agent-1.context@}}updated prompt', expect.any(Function))
    expect(onChange).toHaveBeenCalledWith('{{@agent-1.context@}}updated prompt')
    expect(screen.getByText(/workflow\.nodes\.tool\.agentPlaceholder/)).toBeInTheDocument()
  })

  it('should open the agent sub-graph and internal run flow from the context modal', () => {
    const { unmount } = renderMixedInput({
      value: '{{@agent-1.context@}}',
    })

    fireEvent.click(screen.getByRole('button', { name: 'view-header' }))
    expect(screen.getByTestId('sub-graph-agent')).toBeInTheDocument()

    unmount()
    const AssembleHarness = () => {
      const [text, setText] = useState('')

      return (
        <MixedVariableTextInput
          value={text}
          onChange={(nextText) => {
            setText(nextText)
          }}
          toolNodeId="tool-node"
          paramKey="query"
          availableNodes={availableNodes}
          nodesOutputVars={nodesOutputVars}
        />
      )
    }

    render(<AssembleHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'select-assemble' }))
    act(() => {
      vi.runAllTimers()
    })
    fireEvent.click(screen.getByRole('button', { name: 'context-run-internal' }))

    expect(screen.getByTestId('sub-graph-assemble')).toBeInTheDocument()
  })

  it('should pass editable and variable insertion flags through to the prompt editor', () => {
    renderMixedInput({
      readOnly: true,
      disableVariableInsertion: true,
    })

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      editable: false,
      workflowVariableBlock: expect.objectContaining({
        show: false,
      }),
    }))
  })

  it('should fall back cleanly when tool ids, assemble ids, or node matches are missing', () => {
    mockAssembleExtractorNodeId.value = ''
    renderMixedInput({
      value: '{{@missing.context@}}',
      toolNodeId: undefined,
      paramKey: '',
      availableNodes: [{
        id: 'start-node',
        position: { x: 0, y: 0 },
        data: {
          title: 'Start',
          type: BlockEnum.Start,
          height: 120,
          width: 240,
          position: { x: 0, y: 0 },
        },
      }] as unknown as Node[],
      nodesOutputVars: undefined,
    })

    fireEvent.click(screen.getByRole('button', { name: 'select-agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'select-assemble' }))

    expect(mockEnsureExtractorNode).not.toHaveBeenCalled()
    expect(mockEnsureAssembleExtractorNode).not.toHaveBeenCalled()
    expect(screen.queryByTestId('context-generate-modal')).not.toBeInTheDocument()
    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      workflowVariableBlock: expect.objectContaining({
        agentNodes: [],
        variables: [],
        showAssembleVariables: false,
      }),
    }))
  })

  it('should compute warnings from validator metadata for agents and assemble extractors', () => {
    const checkValid = vi.fn((nodeData: Record<string, unknown>) => ({
      errorMessage: nodeData.type === BlockEnum.Agent ? 'agent warning' : '',
    }))
    mockNodesMetaDataMap = {
      [BlockEnum.Agent]: {
        checkValid,
      },
      [BlockEnum.LLM]: {
        checkValid: vi.fn(() => ({ errorMessage: '' })),
      },
      [BlockEnum.Code]: {
        checkValid: vi.fn(() => ({ errorMessage: 'assemble warning' })),
      },
    }
    mockStrategyProviders = [{
      declaration: {
        identity: { name: 'provider-1' },
        strategies: [{ identity: { name: 'strategy-1' } }],
      },
    }]
    reactFlowNodes = [
      {
        id: 'agent-1',
        data: {
          title: 'Agent One',
          type: BlockEnum.Agent,
          agent_strategy_provider_name: 'provider-1',
          agent_strategy_name: 'strategy-1',
        },
      } as unknown as { id: string, data: Record<string, unknown> },
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
      } as unknown as { id: string, data: Record<string, unknown> },
    ]

    const { rerender } = render(
      <MixedVariableTextInput
        value="{{@agent-1.context@}}"
        onChange={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        availableNodes={availableNodes}
        nodesOutputVars={nodesOutputVars}
      />,
    )

    expect(screen.getByText('warning-on')).toBeInTheDocument()
    expect(checkValid).toHaveBeenCalledWith(expect.objectContaining({
      type: BlockEnum.Agent,
    }), expect.any(Function), expect.objectContaining({
      language: 'en_US',
      isReadyForCheckValid: true,
    }))

    rerender(
      <MixedVariableTextInput
        value="{{#tool-node_ext_query.result#}}"
        onChange={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        availableNodes={availableNodes}
        nodesOutputVars={nodesOutputVars}
      />,
    )

    expect(screen.getByText('warning-on')).toBeInTheDocument()
  })

  it('should close sub-graph and context modals through the provided callbacks', () => {
    const { unmount } = renderMixedInput({
      value: '{{#tool-node_ext_query.result#}}',
    })

    fireEvent.click(screen.getByRole('button', { name: 'view-header' }))
    expect(screen.getByTestId('sub-graph-assemble')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'close-sub-graph' }))
    expect(screen.queryByTestId('sub-graph-assemble')).not.toBeInTheDocument()

    unmount()
    renderMixedInput()
    fireEvent.click(screen.getByRole('button', { name: 'select-assemble' }))
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.getByTestId('context-generate-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'context-close' }))
    expect(screen.queryByTestId('context-generate-modal')).not.toBeInTheDocument()
  })

  it('should clear pending sub-graph run state after the nested modal handles it', () => {
    const AssembleHarness = () => {
      const [text, setText] = useState('{{#tool-node_ext_query.result#}}')

      return (
        <MixedVariableTextInput
          value={text}
          onChange={(nextText) => {
            setText(nextText)
          }}
          toolNodeId="tool-node"
          paramKey="query"
          availableNodes={availableNodes}
          nodesOutputVars={nodesOutputVars}
        />
      )
    }

    render(<AssembleHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'view-header' }))
    expect(screen.getByTestId('sub-graph-assemble')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'handled-sub-graph' }))
    expect(screen.getByTestId('sub-graph-assemble')).toBeInTheDocument()
  })

  it('should fall back to workflow extractor ids and early-return remove actions when callbacks are absent', () => {
    mockAssembleExtractorNodeId.value = ''
    renderMixedInput({
      value: '{{@agent-1.context@}}',
      onChange: undefined,
    })

    fireEvent.click(screen.getByRole('button', { name: 'remove-header' }))
    fireEvent.click(screen.getByRole('button', { name: 'select-agent' }))

    expect(mockRemoveExtractorNode).not.toHaveBeenCalled()
    expect(mockEnsureExtractorNode).not.toHaveBeenCalled()
  })

  it('should use the fallback extractor id when opening assemble flows and guard assemble removal without callbacks', () => {
    mockAssembleExtractorNodeId.value = ''
    reactFlowNodes = [
      ...availableNodes,
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
      } as unknown as { id: string, data: Record<string, unknown> },
    ]

    render(
      <MixedVariableTextInput
        value=""
        onChange={vi.fn()}
        toolNodeId="tool-node"
        paramKey="query"
        availableNodes={availableNodes}
        nodesOutputVars={nodesOutputVars}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'select-assemble' }))
    act(() => {
      vi.runAllTimers()
    })

    expect(mockOnOpenContextGenerateModal).toHaveBeenCalledTimes(1)

    const { unmount } = renderMixedInput({
      value: '{{#tool-node_ext_query.result#}}',
      onChange: undefined,
    })
    fireEvent.click(screen.getByRole('button', { name: 'remove-header' }))
    expect(mockClearContextGenStorage).not.toHaveBeenCalled()
    unmount()
  })

  it('should warn when the detected agent is not present in the workflow graph', () => {
    mockNodesMetaDataMap = {
      [BlockEnum.Agent]: {
        checkValid: vi.fn(() => ({ errorMessage: 'agent warning' })),
      },
    }
    reactFlowNodes = []

    render(
      <MixedVariableTextInput
        value="{{@agent-1.context@}}"
        onChange={vi.fn()}
        toolNodeId={undefined}
        paramKey=""
        availableNodes={availableNodes}
        nodesOutputVars={nodesOutputVars}
      />,
    )

    expect(screen.getByText('warning-on')).toBeInTheDocument()
  })
})
