import type { InputVar, Node } from '../../../types'
import type { LoopNodeType } from '../types'
import type { NodeTracing } from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, ErrorHandleMode, InputVarType, ValueType, VarType } from '@/app/components/workflow/types'
import { ComparisonOperator, LogicalOperator } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseIsNodeInLoop = vi.hoisted(() => vi.fn())
const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockFormatTracing = vi.hoisted(() => vi.fn())
const mockGetNodeUsedVars = vi.hoisted(() => vi.fn())
const mockGetNodeUsedVarPassToServerKey = vi.hoisted(() => vi.fn())
const mockGetNodeInfoById = vi.hoisted(() => vi.fn())
const mockIsSystemVar = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks', () => ({
  useIsNodeInLoop: (...args: unknown[]) => mockUseIsNodeInLoop(...args),
  useWorkflow: () => mockUseWorkflow(),
}))

vi.mock('@/app/components/workflow/run/utils/format-log', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatTracing(...args),
}))

vi.mock('../../_base/components/variable/utils', () => ({
  getNodeUsedVars: (...args: unknown[]) => mockGetNodeUsedVars(...args),
  getNodeUsedVarPassToServerKey: (...args: unknown[]) => mockGetNodeUsedVarPassToServerKey(...args),
  getNodeInfoById: (...args: unknown[]) => mockGetNodeInfoById(...args),
  isSystemVar: (...args: unknown[]) => mockIsSystemVar(...args),
}))

const createLoopNode = (overrides: Partial<LoopNodeType> = {}): LoopNodeType => ({
  title: 'Loop',
  desc: '',
  type: BlockEnum.Loop,
  start_node_id: 'start-node',
  loop_count: 3,
  error_handle_mode: ErrorHandleMode.Terminated,
  break_conditions: [],
  loop_variables: [],
  ...overrides,
})

const createVariableNode = (id: string, title: string, type = BlockEnum.Tool): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    title,
    type,
    desc: '',
  },
} as Node)

const createInputVar = (variable: string): InputVar => ({
  type: InputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

const createRunTrace = (): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'loop-node',
  node_type: BlockEnum.Loop,
  title: 'Loop',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: 'succeeded',
  elapsed_time: 1,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 2,
    loop_index: 1,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
  },
  finished_at: 1,
})

describe('useSingleRunFormParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseIsNodeInLoop.mockReturnValue({
      isNodeInLoop: (nodeId: string) => nodeId === 'inner-node',
    })
    mockUseWorkflow.mockReturnValue({
      getLoopNodeChildren: () => [
        createVariableNode('tool-a', 'Tool A'),
        createVariableNode('loop-node', 'Loop Node'),
        createVariableNode('inner-node', 'Inner Node'),
      ],
      getBeforeNodesInSameBranch: () => [
        createVariableNode('start-node', 'Start Node', BlockEnum.Start),
      ],
    })
    mockGetNodeUsedVars.mockImplementation((node: Node) => {
      if (node.id === 'tool-a')
        return [['start-node', 'answer']]
      if (node.id === 'loop-node')
        return [['loop-node', 'item']]
      if (node.id === 'inner-node')
        return [['inner-node', 'secret']]
      return []
    })
    mockGetNodeUsedVarPassToServerKey.mockReturnValue('passed_key')
    mockGetNodeInfoById.mockImplementation((nodes: Node[], id: string) => nodes.find(node => node.id === id))
    mockIsSystemVar.mockReturnValue(false)
    mockFormatTracing.mockReturnValue([{
      id: 'formatted-node',
      execution_metadata: { loop_index: 9 },
    }])
  })

  it('should build single-run forms and filter out loop-local variables', () => {
    const toVarInputs = vi.fn((variables: Array<{ variable: string }>) => variables.map(item => createInputVar(item.variable)))
    const varSelectorsToVarInputs = vi.fn(() => [
      createInputVar('tool-a.result'),
      createInputVar('tool-a.result'),
      createInputVar('start-node.answer'),
    ])

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'loop-node',
      payload: createLoopNode({
        break_conditions: [{
          id: 'condition-1',
          varType: VarType.string,
          variable_selector: ['tool-a', 'result'],
          comparison_operator: ComparisonOperator.equal,
          value: '',
          sub_variable_condition: {
            logical_operator: LogicalOperator.and,
            conditions: [],
          },
        }],
        loop_variables: [{
          id: 'loop-variable-1',
          label: 'Loop Value',
          var_type: VarType.string,
          value_type: ValueType.variable,
          value: ['start-node', 'answer'],
        }],
      }),
      runInputData: {
        question: 'hello',
      },
      runResult: null as unknown as NodeTracing,
      loopRunResult: [],
      setRunInputData: vi.fn(),
      toVarInputs,
      varSelectorsToVarInputs,
    }))

    expect(toVarInputs).toHaveBeenCalledWith([
      expect.objectContaining({ variable: 'start-node.answer' }),
    ])
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0].inputs).toEqual([
      createInputVar('start-node.answer'),
      createInputVar('tool-a.result'),
      createInputVar('start-node.answer'),
    ])
    expect(result.current.forms[0].values).toEqual({ question: 'hello' })
    expect(result.current.allVarObject).toEqual({
      'start-node.answer@@@tool-a@@@0': {
        inSingleRunPassedKey: 'passed_key',
      },
    })
    expect(result.current.getDependentVars()).toEqual([
      ['start-node', 'answer'],
      ['tool-a', 'result'],
      ['start-node', 'answer'],
    ])
  })

  it('should forward onChange and merge tracing metadata into node info', () => {
    const setRunInputData = vi.fn()
    const runResult = createRunTrace()

    const { result } = renderHook(() => useSingleRunFormParams({
      id: 'loop-node',
      payload: createLoopNode(),
      runInputData: {},
      runResult,
      loopRunResult: [runResult],
      setRunInputData,
      toVarInputs: vi.fn(() => []),
      varSelectorsToVarInputs: vi.fn(() => []),
    }))

    act(() => {
      result.current.forms[0].onChange({ retry: true })
    })

    expect(setRunInputData).toHaveBeenCalledWith({ retry: true })
    expect(mockFormatTracing).toHaveBeenCalledWith([runResult], expect.any(Function))
    expect(result.current.nodeInfo).toEqual({
      id: 'formatted-node',
      execution_metadata: expect.objectContaining({
        loop_index: 9,
      }),
    })
  })
})
