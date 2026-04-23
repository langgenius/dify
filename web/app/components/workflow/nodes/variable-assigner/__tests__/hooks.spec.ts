import { act, renderHook } from '@testing-library/react'
import { VarType } from '../../../types'
import { useGetAvailableVars, useVariableAssigner } from '../hooks'

const mockUseStoreApi = vi.hoisted(() => vi.fn())
const mockUseNodes = vi.hoisted(() => vi.fn())
const mockUseNodeDataUpdate = vi.hoisted(() => vi.fn())
const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockUseWorkflowVariables = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())
const mockUseWorkflowStore = vi.hoisted(() => vi.fn())

vi.mock('reactflow', () => ({
  useStoreApi: () => mockUseStoreApi(),
  useNodes: () => mockUseNodes(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodeDataUpdate: () => mockUseNodeDataUpdate(),
  useWorkflow: () => mockUseWorkflow(),
  useWorkflowVariables: () => mockUseWorkflowVariables(),
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mockUseWorkflowStore(),
}))

describe('variable-assigner/hooks', () => {
  const mockHandleNodeDataUpdate = vi.fn()
  const mockSetNodes = vi.fn()
  const mockSetShowAssignVariablePopup = vi.fn()
  const mockSetHoveringAssignVariableGroupId = vi.fn()
  const getNodes = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    getNodes.mockReturnValue([{
      id: 'assigner-1',
      data: {
        variables: [['start', 'foo']],
        output_type: VarType.string,
        advanced_settings: {
          groups: [{
            groupId: 'group-1',
            variables: [],
            output_type: VarType.string,
          }],
        },
      },
    }])
    mockUseStoreApi.mockReturnValue({
      getState: () => ({
        getNodes,
        setNodes: mockSetNodes,
      }),
    })
    mockUseNodeDataUpdate.mockReturnValue({
      handleNodeDataUpdate: mockHandleNodeDataUpdate,
    })
    mockUseWorkflowStore.mockReturnValue({
      getState: () => ({
        setShowAssignVariablePopup: mockSetShowAssignVariablePopup,
        setHoveringAssignVariableGroupId: mockSetHoveringAssignVariableGroupId,
        connectingNodePayload: { id: 'connecting-node' },
      }),
    })
    mockUseNodes.mockReturnValue([])
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranchIncludeParent: vi.fn(),
    })
    mockUseWorkflowVariables.mockReturnValue({
      getNodeAvailableVars: vi.fn(),
    })
    mockUseIsChatMode.mockReturnValue(false)
  })

  it('should append target variables, ignore duplicates, and update grouped variables', () => {
    const { result } = renderHook(() => useVariableAssigner())

    act(() => {
      result.current.handleAssignVariableValueChange('assigner-1', ['start', 'bar'], { type: VarType.number } as never)
      result.current.handleAssignVariableValueChange('assigner-1', ['start', 'foo'], { type: VarType.number } as never)
      result.current.handleAssignVariableValueChange('assigner-1', ['start', 'grouped'], { type: VarType.arrayString } as never, 'group-1')
    })

    expect(mockHandleNodeDataUpdate).toHaveBeenNthCalledWith(1, {
      id: 'assigner-1',
      data: {
        variables: [
          ['start', 'foo'],
          ['start', 'bar'],
        ],
        output_type: VarType.number,
      },
    })
    expect(mockHandleNodeDataUpdate).toHaveBeenNthCalledWith(2, {
      id: 'assigner-1',
      data: {
        advanced_settings: {
          groups: [{
            groupId: 'group-1',
            variables: [['start', 'grouped']],
            output_type: VarType.arrayString,
          }],
        },
      },
    })
    expect(mockHandleNodeDataUpdate).toHaveBeenCalledTimes(2)
  })

  it('should close the popup and add variables through the positioned add-variable flow', () => {
    getNodes.mockReturnValue([
      {
        id: 'source-node',
        data: {
          _showAddVariablePopup: true,
          _holdAddVariablePopup: true,
        },
      },
      {
        id: 'assigner-1',
        data: {
          variables: [],
          advanced_settings: {
            groups: [{
              groupId: 'group-1',
              variables: [],
            }],
          },
          _showAddVariablePopup: true,
          _holdAddVariablePopup: true,
        },
      },
    ])

    const { result } = renderHook(() => useVariableAssigner())

    act(() => {
      result.current.handleAddVariableInAddVariablePopupWithPosition(
        'source-node',
        'assigner-1',
        'group-1',
        ['start', 'output'],
        { type: VarType.object } as never,
      )
    })

    expect(mockSetNodes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'source-node',
        data: expect.objectContaining({
          _showAddVariablePopup: false,
          _holdAddVariablePopup: false,
        }),
      }),
      expect.objectContaining({
        id: 'assigner-1',
        data: expect.objectContaining({
          _showAddVariablePopup: false,
          _holdAddVariablePopup: false,
        }),
      }),
    ])
    expect(mockSetShowAssignVariablePopup).toHaveBeenCalledWith(undefined)
    expect(mockHandleNodeDataUpdate).toHaveBeenCalledWith({
      id: 'assigner-1',
      data: {
        advanced_settings: {
          groups: [{
            groupId: 'group-1',
            variables: [['start', 'output']],
            output_type: VarType.object,
          }],
        },
      },
    })
  })

  it('should update the hovered group state on enter and leave', () => {
    const { result } = renderHook(() => useVariableAssigner())

    act(() => {
      result.current.handleGroupItemMouseEnter('group-1')
      result.current.handleGroupItemMouseLeave()
    })

    expect(mockSetHoveringAssignVariableGroupId).toHaveBeenNthCalledWith(1, 'group-1')
    expect(mockSetHoveringAssignVariableGroupId).toHaveBeenNthCalledWith(2, undefined)
  })

  it('should collect available vars and filter start-node env vars when hideEnv is enabled', () => {
    mockUseNodes.mockReturnValue([
      {
        id: 'current-node',
        parentId: 'parent-node',
      },
      {
        id: 'before-1',
      },
      {
        id: 'parent-node',
      },
    ])
    const getBeforeNodesInSameBranchIncludeParent = vi.fn(() => [
      { id: 'before-1' },
      { id: 'before-1' },
    ])
    const getNodeAvailableVars = vi.fn()
      .mockReturnValueOnce([{
        isStartNode: true,
        vars: [
          { variable: 'sys.user_id' },
          { variable: 'foo' },
        ],
      }, {
        isStartNode: false,
        vars: [],
      }])
      .mockReturnValueOnce([{
        isStartNode: false,
        vars: [{ variable: 'bar' }],
      }])

    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranchIncludeParent,
    })
    mockUseWorkflowVariables.mockReturnValue({
      getNodeAvailableVars,
    })

    const { result } = renderHook(() => useGetAvailableVars())

    expect(result.current('current-node', 'target', () => true, true)).toEqual([{
      isStartNode: true,
      vars: [{ variable: 'foo' }],
    }])
    expect(result.current('current-node', 'target', () => true, false)).toEqual([{
      isStartNode: false,
      vars: [{ variable: 'bar' }],
    }])
    expect(result.current('missing-node', 'target', () => true)).toEqual([])
  })
})
