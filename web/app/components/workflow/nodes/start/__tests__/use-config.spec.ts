import type { Shape as HooksStoreShape } from '../../../hooks-store/store'
import type { InputVar } from '../../../types'
import type { StartNodeType } from '../types'
import { act } from '@testing-library/react'
import { useNodes, useReactFlow } from 'reactflow'
import { createEdge, createNode, createStartNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../__tests__/workflow-test-env'
import { BlockEnum, ChangeType, InputVarType } from '../../../types'
import useConfig from '../use-config'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { error: notify } }))

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Question',
  variable: 'query',
  type: InputVarType.textInput,
  required: true,
  ...overrides,
})

const renderConfig = () => {
  const variables = [
    createInputVar(),
    createInputVar({ label: 'Age', variable: 'age', type: InputVarType.number, required: false }),
  ]
  const start = createStartNode({ id: 'start-node', data: { variables } })
  const nodes = [
    start,
    createNode({
      id: 'consumer',
      data: {
        variables: [
          { variable: 'question', value_selector: ['start-node', 'query'] },
          { variable: 'age', value_selector: ['start-node', 'age'] },
        ],
      },
    }),
  ]
  // Inspector persistence is supplied by the editor owner through the hooks store.
  const renameInspectVarName = vi
    .fn<HooksStoreShape['renameInspectVarName']>()
    .mockResolvedValue(undefined)
  const deleteInspectVar = vi.fn<HooksStoreShape['deleteInspectVar']>().mockResolvedValue(undefined)
  const deleteNodeInspectorVars = vi
    .fn<HooksStoreShape['deleteNodeInspectorVars']>()
    .mockResolvedValue(undefined)
  const view = renderWorkflowCanvasHook(
    () => {
      const startNode = useNodes<StartNodeType>().find((node) => node.id === start.id)!
      return { ...useConfig(start.id, startNode.data), flow: useReactFlow() }
    },
    {
      nodes,
      edges: [createEdge({ source: start.id, target: 'consumer' })],
      hooksStoreProps: { renameInspectVarName, deleteInspectVar, deleteNodeInspectorVars },
      initialStoreState: {
        nodesWithInspectVars: [
          {
            nodeId: start.id,
            nodePayload: start.data,
            nodeType: BlockEnum.Start,
            title: 'Start',
            vars: [
              {
                id: 'inspect-query',
                type: 'node',
                name: 'query',
                description: '',
                selector: [start.id, 'query'],
                value_type: 'string',
                value: 'hello',
                edited: false,
                visible: true,
                is_truncated: false,
              },
            ],
          },
        ],
      },
    },
  )
  return { ...view, variables, renameInspectVarName, deleteInspectVar, deleteNodeInspectorVars }
}

const removal = { index: 0, payload: { type: ChangeType.remove, payload: { beforeKey: 'query' } } }

describe('start/use-config', () => {
  it('renames the saved variable and its downstream references', () => {
    const { result, variables, renameInspectVarName } = renderConfig()
    const renamed = [createInputVar({ variable: 'prompt' }), variables[1]!]

    act(() =>
      result.current.handleVarListChange(renamed, {
        index: 0,
        payload: { type: ChangeType.changeVarName, payload: { beforeKey: 'query' } },
      }),
    )

    expect(result.current.inputs.variables).toEqual(renamed)
    expect(result.current.flow.getNode('consumer')?.data.variables).toEqual([
      { variable: 'question', value_selector: ['start-node', 'prompt'] },
      { variable: 'age', value_selector: ['start-node', 'age'] },
    ])
    expect(renameInspectVarName).toHaveBeenCalledExactlyOnceWith('start-node', 'query', 'prompt')
  })

  it('keeps a referenced variable until confirmation, then removes it and clears its references', () => {
    const { result, variables, deleteInspectVar } = renderConfig()
    act(() => result.current.handleVarListChange([variables[1]!], removal))

    expect(result.current.isShowRemoveVarConfirm).toBe(true)
    expect(result.current.inputs.variables).toEqual(variables)
    expect(deleteInspectVar).not.toHaveBeenCalled()

    act(() => result.current.onRemoveVarConfirm())

    expect(result.current.inputs.variables).toEqual([variables[1]])
    expect(result.current.flow.getNode('consumer')?.data.variables).toEqual([
      { variable: 'question', value_selector: [] },
      { variable: 'age', value_selector: ['start-node', 'age'] },
    ])
    expect(deleteInspectVar).toHaveBeenCalledExactlyOnceWith('start-node', 'inspect-query')
    expect(result.current.isShowRemoveVarConfirm).toBe(false)
  })

  it('preserves the graph and inspector value when removal is cancelled', () => {
    const { result, variables, deleteInspectVar } = renderConfig()
    const before = result.current.flow.getNodes()
    act(() => result.current.handleVarListChange([variables[1]!], removal))
    expect(result.current.isShowRemoveVarConfirm).toBe(true)

    act(() => result.current.hideRemoveVarConfirm())

    expect(result.current.isShowRemoveVarConfirm).toBe(false)
    expect(result.current.flow.getNodes()).toEqual(before)
    expect(deleteInspectVar).not.toHaveBeenCalled()
  })

  it('rejects a duplicate key without changing the node, then saves a unique variable', () => {
    const { result, variables } = renderConfig()
    act(() => {
      expect(result.current.handleAddVariable(createInputVar({ label: 'Different label' }))).toBe(
        false,
      )
    })
    expect(result.current.inputs.variables).toEqual(variables)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('varKeyError.keyAlreadyExists'))

    const locale = createInputVar({ label: 'Locale', variable: 'locale', required: false })
    act(() => {
      expect(result.current.handleAddVariable(locale)).toBe(true)
    })
    expect(result.current.inputs.variables).toEqual([...variables, locale])
  })

  it('saves a type edit and clears inspector values, but rejects a duplicate label', () => {
    const { result, variables, deleteNodeInspectorVars } = renderConfig()
    const edited = [createInputVar({ type: InputVarType.paragraph }), variables[1]!]
    act(() => result.current.handleVarListChange(edited))

    expect(result.current.inputs.variables).toEqual(edited)
    expect(deleteNodeInspectorVars).toHaveBeenCalledExactlyOnceWith('start-node')

    act(() => {
      expect(
        result.current.handleAddVariable(createInputVar({ label: 'Age', variable: 'new_age' })),
      ).toBe(false)
    })
    expect(result.current.inputs.variables).toEqual(edited)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('varKeyError.keyAlreadyExists'))
  })
})
