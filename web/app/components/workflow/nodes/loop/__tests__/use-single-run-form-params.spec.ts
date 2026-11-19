import type { InputVar, Node } from '../../../types'
import type { LoopNodeType } from '../types'
import type { NodeTracing } from '@/types/workflow'
import { act, waitFor } from '@testing-library/react'
import { useNodes } from 'reactflow'
import {
  BlockEnum,
  ErrorHandleMode,
  InputVarType,
  ValueType,
  VarType,
} from '@/app/components/workflow/types'
import { createEdge, createNode, createNodeTracing } from '../../../__tests__/fixtures'
import { renderWorkflowFlowHook } from '../../../__tests__/workflow-test-env'
import { ComparisonOperator, LogicalOperator } from '../types'
import useSingleRunFormParams from '../use-single-run-form-params'

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

const createVariableNode = (id: string, title: string, type: BlockEnum = BlockEnum.Tool): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: {
      title,
      type,
      desc: '',
      tool_configurations: {},
      tool_parameters:
        id === 'tool-a'
          ? {
              answer: { type: 'variable', value: ['start-node', 'answer'] },
              inner: { type: 'variable', value: ['inner-node', 'secret'] },
              self: { type: 'variable', value: ['loop-node', 'item'] },
            }
          : {},
    },
  }) as Node

const createInputVar = (variable: string): InputVar => ({
  type: InputVarType.textInput,
  label: variable,
  variable,
  required: false,
})

const createRunTrace = () =>
  createNodeTracing({
    id: 'trace-1',
    node_id: 'loop-node',
    node_type: BlockEnum.Loop,
    title: 'Loop',
    status: 'succeeded',
    execution_metadata: { total_tokens: 0, total_price: 0, currency: 'USD', loop_index: 1 },
  })

const renderHook = <T>(callback: () => T) =>
  renderWorkflowFlowHook(
    () => {
      useNodes()
      return callback()
    },
    {
      nodes: [
        createVariableNode('start-node', 'Start Node', BlockEnum.Start),
        createNode({ id: 'loop-node', data: createLoopNode() }),
        { ...createVariableNode('tool-a', 'Tool A'), parentId: 'loop-node' },
        { ...createVariableNode('inner-node', 'Inner Node'), parentId: 'loop-node' },
      ],
      edges: [createEdge({ source: 'start-node', target: 'loop-node' })],
    },
  )

describe('useSingleRunFormParams', () => {
  it('should build single-run forms and filter out loop-local variables', async () => {
    const toVarInputs = vi.fn((variables: Array<{ variable: string }>) =>
      variables.map((item) => createInputVar(item.variable)),
    )
    const varSelectorsToVarInputs = vi.fn(() => [
      createInputVar('tool-a.result'),
      createInputVar('tool-a.result'),
      createInputVar('start-node.answer'),
    ])

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'loop-node',
        payload: createLoopNode({
          break_conditions: [
            {
              id: 'condition-1',
              varType: VarType.string,
              variable_selector: ['tool-a', 'result'],
              comparison_operator: ComparisonOperator.equal,
              value: '',
              sub_variable_condition: {
                logical_operator: LogicalOperator.and,
                conditions: [],
              },
            },
          ],
          loop_variables: [
            {
              id: 'loop-variable-1',
              label: 'Loop Value',
              var_type: VarType.string,
              value_type: ValueType.variable,
              value: ['start-node', 'answer'],
            },
          ],
        }),
        runInputData: {
          question: 'hello',
        },
        runResult: null as unknown as NodeTracing,
        loopRunResult: [],
        setRunInputData: vi.fn(),
        toVarInputs,
        varSelectorsToVarInputs,
      }),
    )

    await waitFor(() =>
      expect(toVarInputs).toHaveBeenCalledWith([
        expect.objectContaining({ variable: 'start-node.answer' }),
      ]),
    )
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]!.inputs).toEqual([
      createInputVar('start-node.answer'),
      createInputVar('tool-a.result'),
      createInputVar('start-node.answer'),
    ])
    expect(result.current.forms[0]!.values).toEqual({ question: 'hello' })
    expect(result.current.allVarObject).toEqual({
      'start-node.answer@@@tool-a@@@0': {
        inSingleRunPassedKey: '#start-node.answer#',
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

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'loop-node',
        payload: createLoopNode(),
        runInputData: {},
        runResult,
        loopRunResult: [runResult],
        setRunInputData,
        toVarInputs: vi.fn(() => []),
        varSelectorsToVarInputs: vi.fn(() => []),
      }),
    )

    act(() => {
      result.current.forms[0]!.onChange({ retry: true })
    })

    expect(setRunInputData).toHaveBeenCalledWith({ retry: true })

    expect(result.current.nodeInfo).toMatchObject({
      id: 'trace-1',
      execution_metadata: expect.objectContaining({
        loop_index: 1,
      }),
    })
  })
})
