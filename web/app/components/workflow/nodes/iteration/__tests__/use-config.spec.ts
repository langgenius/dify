import type { IterationNodeType } from '../types'
import { act } from '@testing-library/react'
import { createNode } from '../../../__tests__/fixtures'
import { BlockEnum, ErrorHandleMode, VarType } from '../../../types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { VarKindType } from '../../_base/types'
import useConfig from '../use-config'
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
const setup = () => {
  const data = createPayload()
  return renderNodeConfig(useConfig, data, {
    nodeId: 'iteration-node',
    nodes: [
      createNode({ id: 'iteration-node', data }),
      createNode({
        id: 'child',
        parentId: 'iteration-node',
        data: {
          type: BlockEnum.Code,
          isInIteration: true,
          iteration_id: 'iteration-node',
          outputs: { result: { type: VarType.number } },
        },
      }),
    ],
  })
}
it('discovers output variables from actual iteration children', () => {
  const { result } = setup()
  expect(result.current.config.childrenNodeVars).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'child',
        vars: [expect.objectContaining({ variable: 'result', type: VarType.number })],
      }),
    ]),
  )
  expect(result.current.config.filterInputVar({ variable: 'files', type: VarType.arrayFile })).toBe(
    true,
  )
  expect(result.current.config.filterInputVar({ variable: 'text', type: VarType.string })).toBe(
    false,
  )
})
it('persists iterator and output selectors across consecutive changes', () => {
  const { result } = setup()
  act(() =>
    result.current.config.handleInputChange(['start', 'documents'], VarKindType.variable, {
      variable: 'documents',
      type: VarType.arrayObject,
    }),
  )
  act(() =>
    result.current.config.handleOutputVarChange(['child', 'score'], VarKindType.variable, {
      variable: 'score',
      type: VarType.number,
    }),
  )
  expect(result.current.flow.getNode('iteration-node')?.data).toEqual(
    expect.objectContaining({
      iterator_selector: ['start', 'documents'],
      iterator_input_type: VarType.arrayObject,
      output_selector: ['child', 'score'],
      output_type: VarType.arrayNumber,
    }),
  )
  act(() => result.current.config.handleInputChange('', VarKindType.variable))
  act(() =>
    result.current.config.handleOutputVarChange('', VarKindType.variable, {
      variable: 'flag',
      type: VarType.boolean,
    }),
  )
  expect(result.current.config.inputs).toEqual(
    expect.objectContaining({
      iterator_selector: [],
      output_selector: [],
      output_type: VarType.arrayString,
    }),
  )
})
it('persists parallel execution settings without losing earlier edits', () => {
  const { result } = setup()
  act(() => result.current.config.changeParallel(true))
  act(() =>
    result.current.config.changeErrorResponseMode({
      name: 'Continue',
      value: ErrorHandleMode.ContinueOnError,
    }),
  )
  act(() => result.current.config.changeParallelNums(6))
  act(() => result.current.config.changeFlattenOutput(true))
  expect(result.current.flow.getNode('iteration-node')?.data).toEqual(
    expect.objectContaining({
      is_parallel: true,
      error_handle_mode: ErrorHandleMode.ContinueOnError,
      parallel_nums: 6,
      flatten_output: true,
    }),
  )
})
