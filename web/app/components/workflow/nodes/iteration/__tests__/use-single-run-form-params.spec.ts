import type { InputVar, Node } from '../../../types'
import type { IterationNodeType } from '../types'
import type { NodeTracing } from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, ErrorHandleMode, InputVarType, VarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseIsNodeInIteration = vi.hoisted(() => vi.fn())
const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockFormatTracing = vi.hoisted(() => vi.fn())
const mockGetNodeUsedVars = vi.hoisted(() => vi.fn())
const mockGetNodeUsedVarPassToServerKey = vi.hoisted(() => vi.fn())
const mockGetNodeInfoById = vi.hoisted(() => vi.fn())
const mockIsSystemVar = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsNodeInIteration: (...args: unknown[]) => mockUseIsNodeInIteration(...args),
  useWorkflow: () => mockUseWorkflow(),
}))

vi.mock('@/app/components/workflow/run/utils/format-log', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatTracing(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', () => ({
  getNodeUsedVars: (...args: unknown[]) => mockGetNodeUsedVars(...args),
  getNodeUsedVarPassToServerKey: (...args: unknown[]) => mockGetNodeUsedVarPassToServerKey(...args),
  getNodeInfoById: (...args: unknown[]) => mockGetNodeInfoById(...args),
  isSystemVar: (...args: unknown[]) => mockIsSystemVar(...args),
}))

const createInputVar = (variable: string): InputVar => ({
  type: InputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

const createNode = (id: string, title: string, type = BlockEnum.Tool): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    title,
    type,
    desc: '',
  },
} as Node)

const createPayload = (overrides: Partial<IterationNodeType> = {}): IterationNodeType => ({
  title: 'Iteration',
  desc: '',
  type: BlockEnum.Iteration,
  start_node_id: 'start-node',
  iterator_selector: ['start-node', 'items'],
  iterator_input_type: VarType.arrayString,
  output_selector: ['child-node', 'text'],
  output_type: VarType.arrayString,
  is_parallel: false,
  parallel_nums: 2,
  error_handle_mode: ErrorHandleMode.Terminated,
  flatten_output: false,
  _children: [],
  _isShowTips: false,
  ...overrides,
})

describe('iteration/use-single-run-form-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseIsNodeInIteration.mockReturnValue({
      isNodeInIteration: (nodeId: string) => nodeId === 'inner-node',
    })
    mockUseWorkflow.mockReturnValue({
      getIterationNodeChildren: () => [
        createNode('tool-a', 'Tool A'),
        createNode('inner-node', 'Inner Node'),
      ],
      getBeforeNodesInSameBranch: () => [
        createNode('start-node', 'Start Node', BlockEnum.Start),
      ],
    })
    mockGetNodeUsedVars.mockImplementation((node: Node) => {
      if (node.id === 'tool-a')
        return [['start-node', 'answer'], ['inner-node', 'secret'], ['iteration-node', 'item']]
      return []
    })
    mockGetNodeUsedVarPassToServerKey.mockReturnValue('passed_key')
    mockGetNodeInfoById.mockImplementation((nodes: Node[], id: string) => nodes.find(node => node.id === id))
    mockIsSystemVar.mockReturnValue(false)
    mockFormatTracing.mockReturnValue([{ id: 'formatted-node' }])
  })

  it('should build single-run forms from external vars and keep iterator state in a dedicated form', () => {
    const toVarInputs = vi.fn(() => [createInputVar('#start-node.answer#')])

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'iteration-node',
      payload: createPayload(),
      runInputData: {
        'query': 'hello',
        'iteration-node.input_selector': ['start-node', 'items'],
      },
      runInputDataRef: { current: {} },
      getInputVars: vi.fn(),
      setRunInputData: vi.fn(),
      toVarInputs,
      iterationRunResult: [],
    }))

    expect(toVarInputs).toHaveBeenCalledWith([
      expect.objectContaining({
        variable: 'start-node.answer',
        value_selector: ['start-node', 'answer'],
      }),
    ])
    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[0]!.inputs).toEqual([createInputVar('#start-node.answer#')])
    expect(result.current.forms[0]!.values).toEqual({
      'query': 'hello',
      'iteration-node.input_selector': ['start-node', 'items'],
    })
    expect(result.current.forms[1]!.values).toEqual({
      'iteration-node.input_selector': ['start-node', 'items'],
    })
    expect(result.current.allVarObject).toEqual({
      'start-node.answer@@@tool-a@@@0': {
        inSingleRunPassedKey: 'passed_key',
      },
    })
    expect(result.current.nodeInfo).toEqual({ id: 'formatted-node' })
  })

  it('should forward form updates and expose iterator dependencies', () => {
    const setRunInputData = vi.fn()

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'iteration-node',
      payload: createPayload({
        iterator_selector: ['source-node', 'records'],
      }),
      runInputData: {
        'query': 'old',
        'iteration-node.input_selector': ['source-node', 'records'],
      },
      runInputDataRef: { current: {} },
      getInputVars: vi.fn(),
      setRunInputData,
      toVarInputs: vi.fn(() => []),
      iterationRunResult: [] as NodeTracing[],
    }))

    act(() => {
      result.current.forms[0]!.onChange({ query: 'new' })
      result.current.forms[1]!.onChange({
        'iteration-node.input_selector': ['source-node', 'next'],
      })
    })

    expect(setRunInputData).toHaveBeenNthCalledWith(1, { query: 'new' })
    expect(setRunInputData).toHaveBeenNthCalledWith(2, {
      'query': 'old',
      'iteration-node.input_selector': ['source-node', 'next'],
    })
    expect(result.current.getDependentVars()).toEqual([['source-node', 'records']])
    expect(result.current.getDependentVar('iteration-node.input_selector')).toEqual(['source-node', 'records'])
  })
})
