import type { InputVar, Variable } from '../../../types'
import type { IterationNodeType } from '../types'
import { act } from '@testing-library/react'
import { useState } from 'react'
import { BlockEnum, ErrorHandleMode, InputVarType, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook as renderHook } from '../../../__tests__/workflow-test-env'
import useSingleRunFormParams from '../use-single-run-form-params'

const createInputVar = (variable: string): InputVar => ({
  type: InputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

const createPayload = (overrides: Partial<IterationNodeType> = {}): IterationNodeType => ({
  title: 'Iteration',
  desc: '',
  type: BlockEnum.Iteration,
  start_node_id: 'iteration-start',
  iterator_selector: ['source-node', 'records'],
  iterator_input_type: VarType.arrayString,
  output_selector: ['inner-node', 'secret'],
  output_type: VarType.arrayString,
  is_parallel: false,
  parallel_nums: 2,
  error_handle_mode: ErrorHandleMode.Terminated,
  flatten_output: false,
  _children: [],
  _isShowTips: false,
  ...overrides,
})

const graph = () => ({
  nodes: [
    createNode({
      id: 'start-node',
      data: { type: BlockEnum.Start, title: 'Start Node', variables: [createInputVar('answer')] },
    }),
    createNode({
      id: 'source-node',
      data: {
        outputs: { records: { type: VarType.arrayString }, next: { type: VarType.arrayString } },
      },
    }),
    createNode({ id: 'iteration-node', data: createPayload() }),
    createNode({
      id: 'iteration-start',
      type: 'custom-iteration-start',
      parentId: 'iteration-node',
      data: { type: BlockEnum.IterationStart, isInIteration: true },
    }),
    createNode({
      id: 'tool-a',
      parentId: 'iteration-node',
      data: {
        type: BlockEnum.Tool,
        title: 'Tool A',
        isInIteration: true,
        tool_parameters: {
          answer: { type: 'variable', value: ['start-node', 'answer'] },
          inner: { type: 'variable', value: ['inner-node', 'secret'] },
          self: { type: 'variable', value: ['iteration-node', 'item'] },
        },
      },
    }),
    createNode({
      id: 'inner-node',
      parentId: 'iteration-node',
      data: {
        title: 'Inner Node',
        isInIteration: true,
        outputs: { secret: { type: VarType.string } },
      },
    }),
  ],
  edges: [
    createEdge({ source: 'start-node', target: 'source-node' }),
    createEdge({ source: 'source-node', target: 'iteration-node' }),
    createEdge({ source: 'iteration-start', target: 'inner-node' }),
    createEdge({ source: 'inner-node', target: 'tool-a' }),
  ],
})

describe('iteration/use-single-run-form-params', () => {
  it('should build single-run forms from external vars and keep iterator state in a dedicated form', () => {
    // The caller owns field conversion; preserve the selectors discovered by the real graph.
    const toVarInputs = (variables: Variable[]) =>
      variables.map((variable) => createInputVar(`#${variable.value_selector.join('.')}#`))

    const { result } = renderHook(
      () =>
        useSingleRunFormParams({
          id: 'iteration-node',
          payload: createPayload(),
          runInputData: {
            query: 'hello',
            'iteration-node.input_selector': ['source-node', 'records'],
          },
          runInputDataRef: { current: {} },
          getInputVars: () => [],
          setRunInputData: vi.fn(),
          toVarInputs,
          iterationRunResult: [],
        }),
      graph(),
    )

    expect(result.current.forms).toHaveLength(2)
    expect(result.current.forms[0]!.inputs).toEqual([createInputVar('#start-node.answer#')])
    expect(result.current.forms[0]!.values).toEqual({
      query: 'hello',
      'iteration-node.input_selector': ['source-node', 'records'],
    })
    expect(result.current.forms[1]!.values).toEqual({
      'iteration-node.input_selector': ['source-node', 'records'],
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
        getInputVars: () => [],
        setRunInputData,
        toVarInputs: () => [],
        iterationRunResult: [],
      })
    }, graph())
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
