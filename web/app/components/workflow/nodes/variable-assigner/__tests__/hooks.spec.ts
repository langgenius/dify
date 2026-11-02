import type { Node } from '../../../types'
import { act } from '@testing-library/react'
import { useNodes } from 'reactflow'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../../types'
import { useGetAvailableVars, useVariableAssigner } from '../hooks'

// Branch traversal and variable collection have their own suites; here they only feed the filters.
const mockGetBeforeNodesInSameBranchIncludeParent = vi.hoisted(() => vi.fn())
const mockGetNodeAvailableVars = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/use-workflow')>()),
  useWorkflow: () => ({
    getBeforeNodesInSameBranchIncludeParent: mockGetBeforeNodesInSameBranchIncludeParent,
  }),
}))
vi.mock('../../../hooks/use-workflow-variables', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/use-workflow-variables')>()),
  useWorkflowVariables: () => ({ getNodeAvailableVars: mockGetNodeAvailableVars }),
}))

const createAssigner = (data: Record<string, unknown> = {}) =>
  createNode({
    id: 'assigner-1',
    data: {
      type: BlockEnum.VariableAssigner,
      variables: [['start', 'foo']],
      output_type: VarType.string,
      advanced_settings: {
        group_enabled: true,
        groups: [
          { groupId: 'group-1', group_name: 'Group1', variables: [], output_type: VarType.string },
        ],
      },
      ...data,
    },
  })

const renderAssigner = (nodes: Node[] = [createAssigner()], initialStoreState = {}) =>
  renderWorkflowCanvasHook(() => ({ assigner: useVariableAssigner(), nodes: useNodes() }), {
    nodes,
    initialStoreState,
  })

const assignerData = (nodes: { id: string; data: unknown }[]) =>
  nodes.find((node) => node.id === 'assigner-1')!.data as Record<string, unknown>

describe('useVariableAssigner', () => {
  it('appends new target variables, ignores duplicates, and fills grouped variables', () => {
    const { result } = renderAssigner()

    act(() => {
      result.current.assigner.handleAssignVariableValueChange('assigner-1', ['start', 'bar'], {
        variable: 'value',
        type: VarType.number,
      })
      result.current.assigner.handleAssignVariableValueChange('assigner-1', ['start', 'foo'], {
        variable: 'value',
        type: VarType.number,
      })
      result.current.assigner.handleAssignVariableValueChange(
        'assigner-1',
        ['start', 'grouped'],
        { variable: 'grouped', type: VarType.arrayString },
        'group-1',
      )
    })

    expect(assignerData(result.current.nodes)).toMatchObject({
      variables: [
        ['start', 'foo'],
        ['start', 'bar'],
      ],
      output_type: VarType.number,
      advanced_settings: {
        groups: [
          {
            groupId: 'group-1',
            variables: [['start', 'grouped']],
            output_type: VarType.arrayString,
          },
        ],
      },
    })
  })

  it('closes the add-variable popups and adds the picked variable to the group', () => {
    const popupOpen = { _showAddVariablePopup: true, _holdAddVariablePopup: true }
    const { result, store } = renderAssigner(
      [
        createNode({ id: 'source-node', data: popupOpen }),
        createAssigner({ variables: [], ...popupOpen }),
      ],
      { showAssignVariablePopup: { nodeId: 'assigner-1' } },
    )

    act(() =>
      result.current.assigner.handleAddVariableInAddVariablePopupWithPosition(
        'source-node',
        'assigner-1',
        'group-1',
        ['start', 'output'],
        { variable: 'output', type: VarType.object },
      ),
    )

    for (const node of result.current.nodes)
      expect(node.data).toMatchObject({
        _showAddVariablePopup: false,
        _holdAddVariablePopup: false,
      })
    expect(store.getState().showAssignVariablePopup).toBeUndefined()
    expect(assignerData(result.current.nodes)).toMatchObject({
      advanced_settings: {
        groups: [
          { groupId: 'group-1', variables: [['start', 'output']], output_type: VarType.object },
        ],
      },
    })
  })

  it.each([
    { connecting: true, afterLeave: undefined },
    { connecting: false, afterLeave: 'group-1' },
  ])(
    'tracks the hovered group and clears it on leave only while connecting (connecting=$connecting)',
    ({ connecting, afterLeave }) => {
      const { result, store } = renderAssigner([createAssigner()], {
        connectingNodePayload: connecting ? { nodeId: 'source-node' } : undefined,
      })

      act(() => result.current.assigner.handleGroupItemMouseEnter('group-1'))
      expect(store.getState().hoveringAssignVariableGroupId).toBe('group-1')

      act(() => result.current.assigner.handleGroupItemMouseLeave())
      expect(store.getState().hoveringAssignVariableGroupId).toBe(afterLeave)
    },
  )
})

describe('useGetAvailableVars', () => {
  const canvas = {
    nodes: [
      createNode({ id: 'parent-node', data: { type: BlockEnum.Iteration } }),
      createNode({ id: 'before-1' }),
      createNode({ id: 'current-node', parentId: 'parent-node' }),
    ],
    edges: [createEdge({ source: 'before-1', target: 'current-node' })],
  }

  beforeEach(() => {
    mockGetBeforeNodesInSameBranchIncludeParent.mockReturnValue([canvas.nodes[1], canvas.nodes[1]])
  })

  it('hides system start variables and empty groups when env vars are hidden', () => {
    mockGetNodeAvailableVars.mockReturnValue([
      { isStartNode: true, vars: [{ variable: 'sys.user_id' }, { variable: 'foo' }] },
      { isStartNode: false, vars: [] },
    ])
    const { result } = renderWorkflowCanvasHook(() => useGetAvailableVars(), canvas)

    expect(result.current('current-node', 'target', () => true, true)).toEqual([
      { isStartNode: true, vars: [{ variable: 'foo' }] },
    ])
    expect(mockGetNodeAvailableVars).toHaveBeenCalledWith(
      expect.objectContaining({
        parentNode: expect.objectContaining({ id: 'parent-node' }),
        beforeNodes: [expect.objectContaining({ id: 'before-1' })],
        hideEnv: true,
        isChatflow: false,
      }),
    )
  })

  it('returns the collected variables unchanged when env vars are shown', () => {
    const vars = [{ isStartNode: false, vars: [{ variable: 'bar' }] }]
    mockGetNodeAvailableVars.mockReturnValue(vars)
    const { result } = renderWorkflowCanvasHook(() => useGetAvailableVars(), canvas)

    expect(result.current('current-node', 'target', () => true, false)).toEqual(vars)
    expect(result.current('missing-node', 'target', () => true)).toEqual([])
  })

  it('filters system variables when the current flow is a snippet', () => {
    mockGetNodeAvailableVars.mockReturnValue([
      { isStartNode: false, vars: [{ variable: 'sys.user_id' }, { variable: 'answer' }] },
    ])
    const { result } = renderWorkflowCanvasHook(() => useGetAvailableVars(), {
      ...canvas,
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
    })

    expect(result.current('current-node', 'target', () => true, false)).toEqual([
      { isStartNode: false, vars: [{ variable: 'answer' }] },
    ])
  })
})
