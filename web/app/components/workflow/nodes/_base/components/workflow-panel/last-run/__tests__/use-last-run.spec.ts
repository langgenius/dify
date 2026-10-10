import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type { ListFilterNodeType } from '@/app/components/workflow/nodes/list-operator/types'
import type { Node } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, ErrorHandleMode, VarType } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import useLastRun from '../use-last-run'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockShowSingleRun = vi.fn()
const mockHandleRun = vi.fn()
const mockIterationChildren = vi.hoisted(() => vi.fn())

vi.mock('../../../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../hooks/use-workflow')>()
  return {
    ...actual,
    useWorkflow: () => ({
      getIterationNodeChildren: mockIterationChildren,
      getBeforeNodesInSameBranch: () => [],
    }),
    useIsNodeInIteration: () => ({ isNodeInIteration: () => false }),
  }
})

vi.mock('../../../../../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../../hooks/use-nodes-sync-draft')>()

  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    }),
  }
})

vi.mock('../../../../../../hooks/use-checklist', () => ({
  useWorkflowRunValidation: () => ({
    warningNodes: [],
  }),
}))

vi.mock('../../../../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    conversationVars: [],
    systemVars: [],
    hasSetInspectVar: vi.fn(() => false),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-one-step-run', () => ({
  default: () => ({
    hideSingleRun: vi.fn(),
    handleRun: mockHandleRun,
    getInputVars: vi.fn(() => []),
    toVarInputs: vi.fn(() => []),
    varSelectorsToVarInputs: vi.fn(() => []),
    runInputData: {},
    runInputDataRef: { current: {} },
    setRunInputData: vi.fn(),
    showSingleRun: mockShowSingleRun,
    runResult: {},
    iterationRunResult: [],
    loopRunResult: [],
    setNodeRunning: vi.fn(),
    checkValid: vi.fn(() => ({ isValid: true })),
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidLastRun: () => vi.fn(),
}))

describe('useLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleSyncWorkflowDraft.mockReset()
  })

  it('syncs the draft before opening a custom single-run form', () => {
    const { result } = renderWorkflowHook(() =>
      useLastRun({
        id: 'data-source-node',
        flowId: 'flow-id',
        flowType: FlowType.appFlow,
        data: {
          type: BlockEnum.DataSource,
          title: 'Data Source',
          desc: '',
        },
        defaultRunInputData: {},
        isPaused: false,
      }),
    )

    act(() => {
      result.current.handleSingleRun()
    })

    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    expect(mockShowSingleRun).toHaveBeenCalledTimes(1)
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  it('submits list inputs from the real container form using selector keys', async () => {
    const child: Node<ListFilterNodeType> = {
      id: 'list',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.ListFilter,
        title: 'List',
        desc: '',
        variable: ['source', 'items'],
        var_type: VarType.arrayNumber,
        item_var_type: VarType.number,
        filter_by: {
          enabled: true,
          conditions: [{ key: '', comparison_operator: '≥', value: '{{#source.minimum#}}' }],
        },
        extract_by: { enabled: true, serial: '{{#source.serial#}}' },
        order_by: { enabled: false, key: '', value: 'asc' },
        limit: { enabled: false },
      },
    }
    mockIterationChildren.mockReturnValue([child])
    mockHandleSyncWorkflowDraft.mockImplementation((_force, _sync, options) => options.onSuccess())
    const data: IterationNodeType = {
      type: BlockEnum.Iteration,
      title: 'Iteration',
      desc: '',
      start_node_id: 'iteration-start',
      iterator_selector: ['source', 'items'],
      iterator_input_type: VarType.arrayNumber,
      output_selector: ['list', 'result'],
      output_type: VarType.arrayNumber,
      is_parallel: false,
      parallel_nums: 1,
      error_handle_mode: ErrorHandleMode.Terminated,
      flatten_output: false,
      _children: [{ nodeId: 'list', nodeType: BlockEnum.ListFilter }],
      _isShowTips: false,
    }
    const { result } = renderWorkflowHook(() =>
      useLastRun({
        id: 'iteration',
        flowId: 'flow-id',
        flowType: FlowType.appFlow,
        data,
        defaultRunInputData: {},
        isPaused: false,
      }),
    )

    await act(async () => {
      await result.current.handleRunWithParams({
        'source.items': [1, 2],
        'source.minimum': 0,
        'source.serial': 1,
        'iteration.input_selector': [1, 2],
      })
    })

    expect(mockHandleRun).toHaveBeenCalledWith({
      'list.#source.items#': [1, 2],
      'list.#source.minimum#': 0,
      'list.#source.serial#': 1,
      'iteration.input_selector': [1, 2],
    })
  })
})
