import type { CommonNodeType, Node } from '../../types'
import type { ChecklistItem } from '../use-checklist'
import { screen, waitFor } from '@testing-library/react'
import { createElement, Fragment } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowComponent, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useStore } from '../../store'
import { BlockEnum } from '../../types'
import { useChecklist, useWorkflowRunValidation } from '../use-checklist'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('reactflow', async () => {
  const base = (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock()
  return {
    ...base,
    getOutgoers: vi.fn((node: Node, nodes: Node[], edges: { source: string, target: string }[]) => {
      return edges
        .filter(e => e.source === node.id)
        .map(e => nodes.find(n => n.id === e.target))
        .filter(Boolean)
    }),
  }
})

vi.mock('@/service/use-tools', async () =>
  (await import('../../__tests__/service-mock-factory')).createToolServiceMock())

vi.mock('@/service/use-triggers', async () =>
  (await import('../../__tests__/service-mock-factory')).createTriggerServiceMock())

vi.mock('@/service/use-strategy', () => ({
  useStrategyProviders: () => ({ data: [] }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({ data: [] }),
}))

type CheckValidFn = (data: CommonNodeType, t: unknown, extra?: unknown) => { errorMessage: string }
const mockNodesMap: Record<string, { checkValid: CheckValidFn, metaData: { isStart: boolean, isRequired: boolean } }> = {}
let mockModelProviders: Array<{ provider: string }> = []
let mockUsedVars: string[][] = []
const mockAvailableVarMap: Record<string, { availableVars: Array<{ nodeId: string, vars: Array<{ variable: string }> }> }> = {}

vi.mock('../use-nodes-meta-data', () => ({
  useNodesMetaData: () => ({
    nodes: [],
    nodesMap: mockNodesMap,
  }),
}))

vi.mock('../use-nodes-available-var-list', () => ({
  default: (nodes: Node[]) => {
    const map: Record<string, { availableVars: Array<{ nodeId: string, vars: Array<{ variable: string }> }> }> = {}
    if (nodes) {
      for (const n of nodes)
        map[n.id] = mockAvailableVarMap[n.id] ?? { availableVars: [] }
    }
    return map
  },
  useGetNodesAvailableVarList: () => ({ getNodesAvailableVarList: vi.fn(() => ({})) }),
}))

vi.mock('../../nodes/_base/components/variable/utils', () => ({
  getNodeUsedVars: () => mockUsedVars,
  isSpecialVar: () => false,
}))

vi.mock('@/app/components/app/store', () => {
  const state = { appDetail: { mode: 'workflow' } }
  return {
    useStore: {
      getState: () => state,
    },
  }
})

vi.mock('../../datasets-detail-store/store', () => ({
  useDatasetsDetailStore: () => ({}),
}))

vi.mock('../index', () => ({
  useGetToolIcon: () => () => undefined,
  useNodesMetaData: () => ({ nodes: [], nodesMap: mockNodesMap }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: { modelProviders: Array<{ provider: string }> }) => unknown) =>
    selector({ modelProviders: mockModelProviders }),
}))

// useWorkflowNodes reads from WorkflowContext (real store via renderWorkflowHook)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupNodesMap() {
  mockNodesMap[BlockEnum.Start] = {
    checkValid: () => ({ errorMessage: '' }),
    metaData: { isStart: true, isRequired: false },
  }
  mockNodesMap[BlockEnum.Code] = {
    checkValid: () => ({ errorMessage: '' }),
    metaData: { isStart: false, isRequired: false },
  }
  mockNodesMap[BlockEnum.LLM] = {
    checkValid: () => ({ errorMessage: '' }),
    metaData: { isStart: false, isRequired: false },
  }
  mockNodesMap[BlockEnum.End] = {
    checkValid: () => ({ errorMessage: '' }),
    metaData: { isStart: false, isRequired: false },
  }
  mockNodesMap[BlockEnum.Tool] = {
    checkValid: () => ({ errorMessage: '' }),
    metaData: { isStart: false, isRequired: false },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetReactFlowMockState()
  resetFixtureCounters()
  Object.keys(mockNodesMap).forEach(k => delete mockNodesMap[k])
  Object.keys(mockAvailableVarMap).forEach(k => delete mockAvailableVarMap[k])
  mockModelProviders = []
  mockUsedVars = []
  setupNodesMap()
})

// ---------------------------------------------------------------------------
// Helper: build a simple connected graph
// ---------------------------------------------------------------------------

function buildConnectedGraph() {
  const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
  const codeNode = createNode({ id: 'code', data: { type: BlockEnum.Code, title: 'Code' } })
  const endNode = createNode({ id: 'end', data: { type: BlockEnum.End, title: 'End' } })
  const nodes = [startNode, codeNode, endNode]
  const edges = [
    createEdge({ source: 'start', target: 'code' }),
    createEdge({ source: 'code', target: 'end' }),
  ]
  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// useChecklist
// ---------------------------------------------------------------------------

describe('useChecklist', () => {
  it('should return empty list when all nodes are valid and connected', () => {
    const { nodes, edges } = buildConnectedGraph()

    const { result } = renderWorkflowHook(
      () => useChecklist(nodes, edges),
    )

    expect(result.current).toEqual([])
  })

  it('should detect disconnected nodes', () => {
    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
    const codeNode = createNode({ id: 'code', data: { type: BlockEnum.Code, title: 'Code' } })
    const isolatedLlm = createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'LLM' } })

    const edges = [
      createEdge({ source: 'start', target: 'code' }),
    ]

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, codeNode, isolatedLlm], edges),
    )

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.unConnected).toBe(true)
  })

  it('should detect validation errors from checkValid', () => {
    mockNodesMap[BlockEnum.LLM] = {
      checkValid: () => ({ errorMessage: 'Model not configured' }),
      metaData: { isStart: false, isRequired: false },
    }

    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
    const llmNode = createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: 'LLM' } })

    const edges = [
      createEdge({ source: 'start', target: 'llm' }),
    ]

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, llmNode], edges),
    )

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.errorMessages).toContain('Model not configured')
  })

  it('should report missing start node in workflow mode', () => {
    const codeNode = createNode({ id: 'code', data: { type: BlockEnum.Code, title: 'Code' } })

    const { result } = renderWorkflowHook(
      () => useChecklist([codeNode], []),
    )

    const startRequired = result.current.find((item: ChecklistItem) => item.id === 'start-node-required')
    expect(startRequired).toBeDefined()
    expect(startRequired!.canNavigate).toBe(false)
  })

  it('should detect plugin not installed', () => {
    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
    const toolNode = createNode({
      id: 'tool',
      data: {
        type: BlockEnum.Tool,
        title: 'My Tool',
        provider_type: CollectionType.builtIn,
        provider_id: 'missing-provider',
        plugin_unique_identifier: 'plugin/tool@0.0.1',
      },
    })

    const edges = [
      createEdge({ source: 'start', target: 'tool' }),
    ]

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, toolNode], edges),
    )

    const warning = result.current.find((item: ChecklistItem) => item.id === 'tool')
    expect(warning).toBeDefined()
    expect(warning!.canNavigate).toBe(false)
    expect(warning!.disableGoTo).toBe(true)
    expect(warning!.isPluginMissing).toBe(true)
    expect(warning!.pluginUniqueIdentifier).toBe('plugin/tool@0.0.1')
    expect(warning!.errorMessages).toContain('workflow.nodes.common.pluginNotInstalled')
  })

  it('should report required node types that are missing', () => {
    mockNodesMap[BlockEnum.End] = {
      checkValid: () => ({ errorMessage: '' }),
      metaData: { isStart: false, isRequired: true },
    }

    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode], []),
    )

    const requiredItem = result.current.find((item: ChecklistItem) => item.id === `${BlockEnum.End}-need-added`)
    expect(requiredItem).toBeDefined()
    expect(requiredItem!.canNavigate).toBe(false)
  })

  it('should not flag start nodes as unconnected', () => {
    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
    const codeNode = createNode({ id: 'code', data: { type: BlockEnum.Code, title: 'Code' } })

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, codeNode], []),
    )

    const startWarning = result.current.find((item: ChecklistItem) => item.id === 'start')
    expect(startWarning).toBeUndefined()
  })

  it('should skip nodes without CUSTOM_NODE type', () => {
    const nonCustomNode = createNode({
      id: 'alien',
      type: 'not-custom',
      data: { type: BlockEnum.Code, title: 'Non-Custom' },
    })
    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, nonCustomNode], []),
    )

    const alienWarning = result.current.find((item: ChecklistItem) => item.id === 'alien')
    expect(alienWarning).toBeUndefined()
  })

  it('should report configure model errors when an llm model provider plugin is missing', () => {
    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
    const llmNode = createNode({
      id: 'llm',
      data: {
        type: BlockEnum.LLM,
        title: 'LLM',
        model: {
          provider: 'langgenius/openai/openai',
        },
      },
    })

    const edges = [
      createEdge({ source: 'start', target: 'llm' }),
    ]

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, llmNode], edges),
    )

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.errorMessages).toContain('workflow.errorMsg.configureModel')
    expect(warning!.canNavigate).toBe(true)
  })

  it('should accumulate validation and invalid variable errors for the same node', () => {
    mockNodesMap[BlockEnum.LLM] = {
      checkValid: () => ({ errorMessage: 'Model not configured' }),
      metaData: { isStart: false, isRequired: false },
    }
    mockUsedVars = [['start', 'missingVar']]
    mockAvailableVarMap.llm = {
      availableVars: [
        {
          nodeId: 'start',
          vars: [{ variable: 'existingVar' }],
        },
      ],
    }

    const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
    const llmNode = createNode({
      id: 'llm',
      data: {
        type: BlockEnum.LLM,
        title: 'LLM',
      },
    })

    const edges = [
      createEdge({ source: 'start', target: 'llm' }),
    ]

    const { result } = renderWorkflowHook(
      () => useChecklist([startNode, llmNode], edges),
    )

    const warning = result.current.find((item: ChecklistItem) => item.id === 'llm')
    expect(warning).toBeDefined()
    expect(warning!.errorMessages).toEqual([
      'Model not configured',
      'workflow.errorMsg.invalidVariable',
    ])
  })

  it('should sync checklist items to the workflow store without render phase update warnings', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const startNode = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
      const codeNode = createNode({ id: 'code', data: { type: BlockEnum.Code, title: 'Code' } })

      function Operator() {
        const checklistItems = useStore(state => state.checklistItems)
        return createElement('div', { 'data-testid': 'checklist-count' }, checklistItems.length)
      }

      function WorkflowChecklist() {
        useChecklist([startNode, codeNode], [])
        return null
      }

      const { store } = renderWorkflowComponent(
        createElement(
          Fragment,
          null,
          createElement(Operator),
          createElement(WorkflowChecklist),
        ),
      )

      await waitFor(() => {
        expect(store.getState().checklistItems).toHaveLength(1)
      })

      expect(screen.getByTestId('checklist-count')).toHaveTextContent('1')
      expect(errorSpy.mock.calls.some(call =>
        call.some(arg => typeof arg === 'string' && arg.includes('Cannot update a component')),
      )).toBe(false)
    }
    finally {
      errorSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// useWorkflowRunValidation
// ---------------------------------------------------------------------------

describe('useWorkflowRunValidation', () => {
  it('should return hasValidationErrors false when there are no warnings', () => {
    const { nodes, edges } = buildConnectedGraph()
    rfState.edges = edges as unknown as typeof rfState.edges

    const { result } = renderWorkflowHook(() => useWorkflowRunValidation(), {
      initialStoreState: { nodes: nodes as Node[] },
    })

    expect(result.current.hasValidationErrors).toBe(false)
    expect(result.current.warningNodes).toEqual([])
  })

  it('should return validateBeforeRun as a function that returns true when valid', () => {
    const { nodes, edges } = buildConnectedGraph()
    rfState.edges = edges as unknown as typeof rfState.edges

    const { result } = renderWorkflowHook(() => useWorkflowRunValidation(), {
      initialStoreState: { nodes: nodes as Node[] },
    })

    expect(typeof result.current.validateBeforeRun).toBe('function')
    expect(result.current.validateBeforeRun()).toBe(true)
  })
})
