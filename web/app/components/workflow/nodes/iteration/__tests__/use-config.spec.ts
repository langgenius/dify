import type { IterationNodeType } from '../types'
import type { Item } from '@/app/components/base/select'
import type { Var } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { BlockEnum, ErrorHandleMode, VarType } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockUseInspectVarsCrud = vi.hoisted(() => vi.fn())
const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())
const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockUseAllBuiltInTools = vi.hoisted(() => vi.fn())
const mockUseAllCustomTools = vi.hoisted(() => vi.fn())
const mockUseAllWorkflowTools = vi.hoisted(() => vi.fn())
const mockUseAllMCPTools = vi.hoisted(() => vi.fn())
const mockToNodeOutputVars = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseInspectVarsCrud(...args),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
  useIsChatMode: () => mockUseIsChatMode(),
  useWorkflow: () => mockUseWorkflow(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { dataSourceList: unknown[] }) => unknown) =>
    selector({ dataSourceList: mockUseStore() }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => mockUseAllBuiltInTools(),
  useAllCustomTools: () => mockUseAllCustomTools(),
  useAllWorkflowTools: () => mockUseAllWorkflowTools(),
  useAllMCPTools: () => mockUseAllMCPTools(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  toNodeOutputVars: (...args: unknown[]) => mockToNodeOutputVars(...args),
}))

const createPayload = (overrides: Partial<IterationNodeType> = {}): IterationNodeType => ({
  title: 'Iteration',
  desc: '',
  type: BlockEnum.Iteration,
  iterator_selector: ['start', 'items'],
  iterator_input_type: VarType.arrayString,
  output_selector: ['child', 'result'],
  output_type: VarType.arrayString,
  is_parallel: false,
  parallel_nums: 3,
  error_handle_mode: ErrorHandleMode.Terminated,
  flatten_output: false,
  start_node_id: 'start-node',
  _children: [],
  _isShowTips: false,
  ...overrides,
})

const createVar = (type: VarType, variable = 'test.variable'): Var => ({
  variable,
  type,
})

describe('iteration/use-config', () => {
  const mockSetInputs = vi.fn()
  const mockDeleteNodeInspectorVars = vi.fn()
  let currentInputs = createPayload()

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()

    mockUseInspectVarsCrud.mockReturnValue({
      deleteNodeInspectorVars: mockDeleteNodeInspectorVars,
    })
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    mockUseIsChatMode.mockReturnValue(false)
    mockUseWorkflow.mockReturnValue({
      getIterationNodeChildren: vi.fn(() => [{ id: 'child-node' }]),
    })
    mockUseStore.mockReturnValue([])
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
    mockUseAllBuiltInTools.mockReturnValue({ data: [] })
    mockUseAllCustomTools.mockReturnValue({ data: [] })
    mockUseAllWorkflowTools.mockReturnValue({ data: [] })
    mockUseAllMCPTools.mockReturnValue({ data: [] })
    mockToNodeOutputVars.mockReturnValue([{ variable: 'child.result' }])
  })

  it('should expose iteration children vars and filter only array-like iterator inputs', () => {
    const { result } = renderHook(() => useConfig('iteration-node', currentInputs))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.childrenNodeVars).toEqual([{ variable: 'child.result' }])
    expect(result.current.iterationChildrenNodes).toEqual([{ id: 'child-node' }])
    expect(result.current.filterInputVar(createVar(VarType.arrayFile, 'files'))).toBe(true)
    expect(result.current.filterInputVar(createVar(VarType.string, 'text'))).toBe(false)
    expect(mockToNodeOutputVars).toHaveBeenCalled()
  })

  it('should update iterator input and output selectors and reset inspector vars on output changes', () => {
    const { result } = renderHook(() => useConfig('iteration-node', currentInputs))

    act(() => {
      result.current.handleInputChange(['start', 'documents'], VarKindType.variable, createVar(VarType.arrayObject, 'start.documents'))
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      iterator_selector: ['start', 'documents'],
      iterator_input_type: VarType.arrayObject,
    }))

    mockSetInputs.mockClear()

    act(() => {
      result.current.handleOutputVarChange(['child', 'score'], VarKindType.variable, createVar(VarType.number, 'child.score'))
    })

    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      output_selector: ['child', 'score'],
      output_type: VarType.arrayNumber,
    }))
    expect(mockDeleteNodeInspectorVars).toHaveBeenCalledWith('iteration-node')

    mockSetInputs.mockClear()

    act(() => {
      result.current.handleOutputVarChange(['child', 'result'], VarKindType.variable, createVar(VarType.string, 'child.result'))
    })

    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('should update parallel, error-mode, and flatten options', () => {
    const { result } = renderHook(() => useConfig('iteration-node', currentInputs))
    const item: Item = { name: 'Continue', value: ErrorHandleMode.ContinueOnError }

    act(() => {
      result.current.changeParallel(true)
      result.current.changeErrorResponseMode(item)
      result.current.changeParallelNums(6)
      result.current.changeFlattenOutput(true)
    })

    expect(mockSetInputs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      is_parallel: true,
    }))
    expect(mockSetInputs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      error_handle_mode: ErrorHandleMode.ContinueOnError,
    }))
    expect(mockSetInputs).toHaveBeenNthCalledWith(3, expect.objectContaining({
      parallel_nums: 6,
    }))
    expect(mockSetInputs).toHaveBeenNthCalledWith(4, expect.objectContaining({
      flatten_output: true,
    }))
  })
})
