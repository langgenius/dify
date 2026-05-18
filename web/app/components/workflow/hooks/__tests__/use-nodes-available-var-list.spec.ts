import type { Node, NodeOutPutVar, Var } from '../../types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '../../types'
import useNodesAvailableVarList, { useGetNodesAvailableVarList } from '../use-nodes-available-var-list'

const mockGetTreeLeafNodes = vi.hoisted(() => vi.fn())
const mockGetBeforeNodesInSameBranchIncludeParent = vi.hoisted(() => vi.fn())
const mockGetNodeAvailableVars = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => true,
  useWorkflow: () => ({
    getTreeLeafNodes: mockGetTreeLeafNodes,
    getBeforeNodesInSameBranchIncludeParent: mockGetBeforeNodesInSameBranchIncludeParent,
  }),
  useWorkflowVariables: () => ({
    getNodeAvailableVars: mockGetNodeAvailableVars,
  }),
}))

const createNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.LLM,
    title: 'Node',
    desc: '',
  },
  ...overrides,
} as Node)

const outputVars: NodeOutPutVar[] = [{
  nodeId: 'vars-node',
  title: 'Vars',
  vars: [{
    variable: 'name',
    type: VarType.string,
  }] satisfies Var[],
}]

describe('useNodesAvailableVarList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBeforeNodesInSameBranchIncludeParent.mockImplementation((nodeId: string) => [createNode({ id: `before-${nodeId}` })])
    mockGetTreeLeafNodes.mockImplementation((nodeId: string) => [createNode({ id: `leaf-${nodeId}` })])
    mockGetNodeAvailableVars.mockReturnValue(outputVars)
  })

  it('builds availability per node, carrying loop nodes and parent iteration context', () => {
    const loopNode = createNode({
      id: 'loop-1',
      data: {
        type: BlockEnum.Loop,
        title: 'Loop',
        desc: '',
      },
    })
    const childNode = createNode({
      id: 'child-1',
      parentId: 'loop-1',
      data: {
        type: BlockEnum.LLM,
        title: 'Writer',
        desc: '',
      },
    })
    const filterVar = vi.fn(() => true)

    const { result } = renderHook(() => useNodesAvailableVarList([loopNode, childNode], {
      filterVar,
      hideEnv: true,
      hideChatVar: true,
    }))

    expect(mockGetBeforeNodesInSameBranchIncludeParent).toHaveBeenCalledWith('loop-1')
    expect(mockGetBeforeNodesInSameBranchIncludeParent).toHaveBeenCalledWith('child-1')
    expect(result.current['loop-1']?.availableNodes.map(node => node.id)).toEqual(['before-loop-1', 'loop-1'])
    expect(result.current['child-1']?.availableVars).toBe(outputVars)
    expect(mockGetNodeAvailableVars).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parentNode: loopNode,
      isChatMode: true,
      filterVar,
      hideEnv: true,
      hideChatVar: true,
    }))
  })

  it('returns a callback version that can use leaf nodes or caller-provided nodes', () => {
    const firstNode = createNode({ id: 'node-a' })
    const secondNode = createNode({ id: 'node-b' })
    const filterVar = vi.fn(() => true)
    const passedInAvailableNodes = [createNode({ id: 'manual-node' })]

    const { result } = renderHook(() => useGetNodesAvailableVarList())

    const leafMap = result.current.getNodesAvailableVarList([firstNode], {
      onlyLeafNodeVar: true,
      filterVar,
    })
    const manualMap = result.current.getNodesAvailableVarList([secondNode], {
      filterVar,
      passedInAvailableNodes,
    })

    expect(mockGetTreeLeafNodes).toHaveBeenCalledWith('node-a')
    expect(leafMap['node-a']?.availableNodes.map(node => node.id)).toEqual(['leaf-node-a'])
    expect(manualMap['node-b']?.availableNodes).toBe(passedInAvailableNodes)
  })
})
