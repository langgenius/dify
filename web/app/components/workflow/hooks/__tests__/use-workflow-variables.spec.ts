import type { ConversationVariable, EnvironmentVariable } from '../../types'
import { act, waitFor } from '@testing-library/react'
import { useNodes, useStoreApi } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import { useWorkflowVariables, useWorkflowVariableType } from '../use-workflow-variables'

// Provider catalogs are external input; variable discovery and type inference remain real.
vi.mock('@tanstack/react-query', async (importOriginal) =>
  (await import('@/test/console/operation-hooks')).mockConsoleOperationHooks(
    await importOriginal(),
    (await import('../../__tests__/service-mock-factory')).createToolOperationRoutes(),
  ),
)
vi.mock('../../nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({ schemaTypeDefinitions: [] }),
}))

const environmentVariables: EnvironmentVariable[] = [
  { id: 'env-1', name: 'limit', value_type: VarType.number, value: 5, description: '' },
]
const conversationVariables: ConversationVariable[] = [
  {
    id: 'conversation-1',
    name: 'topic',
    value_type: VarType.string,
    value: 'hello',
    description: '',
  },
]
const codeNode = createNode({
  id: 'code',
  data: { outputs: { count: { type: VarType.number }, text: { type: VarType.string } } },
})

it('discovers real node, environment and conversation variables and applies visibility/filtering', () => {
  const { result } = renderWorkflowHook(() => useWorkflowVariables(), {
    initialStoreState: { environmentVariables, conversationVariables },
  })
  const options = { beforeNodes: [codeNode], isChatflow: true, filterVar: () => true }
  const vars = result.current.getNodeAvailableVars(options)
  expect(vars).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'env',
        vars: [expect.objectContaining({ variable: 'env.limit', type: VarType.number })],
      }),
      expect.objectContaining({
        nodeId: 'conversation',
        vars: [expect.objectContaining({ variable: 'conversation.topic', type: VarType.string })],
      }),
      expect.objectContaining({
        nodeId: 'code',
        vars: expect.arrayContaining([
          expect.objectContaining({ variable: 'count', type: VarType.number }),
        ]),
      }),
    ]),
  )
  for (const flags of [{ isChatflow: false }, { hideChatVar: true }]) {
    expect(result.current.getNodeAvailableVars({ ...options, ...flags })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeId: 'conversation' })]),
    )
  }
  expect(result.current.getNodeAvailableVars({ ...options, hideEnv: true })).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ nodeId: 'env' })]),
  )
  expect(
    result.current
      .getNodeAvailableVars({ ...options, filterVar: (value) => value.type === VarType.number })
      .flatMap((group) => group.vars),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ variable: 'count' })]))
  expect(
    result.current
      .getNodeAvailableVars({ ...options, filterVar: (value) => value.type === VarType.number })
      .flatMap((group) => group.vars)
      .every((value) => value.type === VarType.number),
  ).toBe(true)
})

it('derives variable types from actual outputs and reads updated store values', () => {
  const { result, store } = renderWorkflowHook(() => useWorkflowVariables(), {
    initialStoreState: { environmentVariables, conversationVariables },
  })
  const typeOf = (valueSelector: string[]) =>
    result.current.getCurrentVariableType({
      valueSelector,
      availableNodes: [codeNode],
      isChatflow: true,
    })
  expect(typeOf(['code', 'count'])).toBe(VarType.number)
  expect(typeOf(['code', 'text'])).toBe(VarType.string)
  expect(typeOf(['env', 'limit'])).toBe(VarType.number)
  expect(typeOf(['conversation', 'topic'])).toBe(VarType.string)
  act(() =>
    store.setState({
      environmentVariables: [
        { ...environmentVariables[0]!, value_type: VarType.string, value: 'five' },
      ],
    }),
  )
  expect(typeOf(['env', 'limit'])).toBe(VarType.string)
})

it('reads live graph output types and resolves iteration index from its actual parent', async () => {
  const iteration = createNode({
    id: 'iteration',
    data: { type: BlockEnum.Iteration, iterator_selector: ['code', 'items'] },
  })
  const child = createNode({ id: 'child', parentId: 'iteration', data: { isInIteration: true } })
  const { result } = renderWorkflowFlowHook(
    () => ({ nodes: useNodes(), typeOf: useWorkflowVariableType(), flow: useStoreApi() }),
    { nodes: [codeNode, iteration, child] },
  )
  expect(result.current.typeOf({ nodeId: 'code', valueSelector: ['code', 'count'] })).toBe(
    VarType.number,
  )
  expect(result.current.typeOf({ nodeId: 'child', valueSelector: ['iteration', 'index'] })).toBe(
    VarType.number,
  )
  await act(async () =>
    result.current.flow.getState().setNodes(
      result.current.flow
        .getState()
        .getNodes()
        .map((node) =>
          node.id === 'code'
            ? { ...node, data: { ...node.data, outputs: { count: { type: VarType.string } } } }
            : node,
        ),
    ),
  )
  await waitFor(() =>
    expect(result.current.nodes.find((node) => node.id === 'code')?.data).toMatchObject({
      outputs: { count: { type: VarType.string } },
    }),
  )
  expect(result.current.typeOf({ nodeId: 'code', valueSelector: ['code', 'count'] })).toBe(
    VarType.string,
  )
})
