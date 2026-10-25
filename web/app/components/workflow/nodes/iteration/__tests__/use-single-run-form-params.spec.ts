import type { InputVar, Node } from '../../../types'
import type { IterationNodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { BlockEnum, ErrorHandleMode, InputVarType, VarType } from '@/app/components/workflow/types'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseIsNodeInIteration = vi.hoisted(() => vi.fn())
const mockUseWorkflow = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-workflow')>()

  return {
    ...actual,
    useIsNodeInIteration: (...args: unknown[]) => mockUseIsNodeInIteration(...args),
    useWorkflow: () => mockUseWorkflow(),
  }
})

const createInputVar = (variable: string): InputVar => ({
  type: InputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

const createNode = (id: string, title: string, type: BlockEnum = BlockEnum.Tool): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: {
      title,
      type,
      desc: '',
      tool_parameters:
        id === 'tool-a'
          ? {
              answer: { type: 'variable', value: ['start-node', 'answer'] },
              inner: { type: 'variable', value: ['inner-node', 'secret'] },
              self: { type: 'variable', value: ['iteration-node', 'item'] },
            }
          : {},
    },
  }) as Node

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
      getBeforeNodesInSameBranch: () => [createNode('start-node', 'Start Node', BlockEnum.Start)],
    })
  })

  it('should build single-run forms from external vars and keep iterator state in a dedicated form', () => {
    const toVarInputs = vi.fn(() => [createInputVar('#start-node.answer#')])

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'iteration-node',
        payload: createPayload(),
        runInputData: {
          query: 'hello',
          'iteration-node.input_selector': ['start-node', 'items'],
        },
        runInputDataRef: { current: {} },
        getInputVars: vi.fn(),
        setRunInputData: vi.fn(),
        toVarInputs,
        iterationRunResult: [],
      }),
    )

    expect(toVarInputs).toHaveBeenCalledWith([
      expect.objectContaining({
        variable: 'start-node.answer',
        value_selector: ['start-node', 'answer'],
      }),
    ])
    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[0]!.inputs).toEqual([createInputVar('#start-node.answer#')])
    expect(result.current.forms[0]!.values).toEqual({
      query: 'hello',
      'iteration-node.input_selector': ['start-node', 'items'],
    })
    expect(result.current.forms[1]!.values).toEqual({
      'iteration-node.input_selector': ['start-node', 'items'],
    })
    expect(result.current.allVarObject).toEqual({
      'start-node.answer@@@tool-a@@@0': {
        inSingleRunPassedKey: '#start-node.answer#',
      },
    })
    expect(result.current.nodeInfo).toBeUndefined()
  })

  it('preserves edited external values when the iterator form changes', () => {
    const { result } = renderHook(() => {
      const [runInputData, setRunInputData] = useState<Record<string, unknown>>({
        query: 'old',
        'iteration-node.input_selector': ['source-node', 'records'],
      })
      return useSingleRunFormParams({
        id: 'iteration-node',
        payload: createPayload({ iterator_selector: ['source-node', 'records'] }),
        runInputData,
        runInputDataRef: { current: runInputData },
        getInputVars: vi.fn(),
        setRunInputData,
        toVarInputs: () => [],
        iterationRunResult: [],
      })
    })
    act(() =>
      result.current.forms[0]!.onChange({
        ...result.current.forms[0]!.values,
        query: 'new',
      }),
    )
    act(() =>
      result.current.forms[1]!.onChange({
        'iteration-node.input_selector': ['source-node', 'next'],
      }),
    )
    expect(result.current.forms[0]!.values).toEqual({
      query: 'new',
      'iteration-node.input_selector': ['source-node', 'next'],
    })
    expect(result.current.forms[1]!.values).toEqual({
      'iteration-node.input_selector': ['source-node', 'next'],
    })
    expect(result.current.getDependentVars()).toEqual([['source-node', 'records']])
    expect(result.current.getDependentVar('iteration-node.input_selector')).toEqual([
      'source-node',
      'records',
    ])
  })
})
