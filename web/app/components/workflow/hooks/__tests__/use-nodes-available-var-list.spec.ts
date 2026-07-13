import type { Node, NodeOutPutVar, Var } from '../../types'
import { renderHook } from '@testing-library/react'
import { useSnippetDraftStore } from '@/app/components/snippets/draft-store'
import { PipelineInputVarType } from '@/models/pipeline'
import { FlowType } from '@/types/common'
import { BlockEnum, VarType } from '../../types'
import useNodesAvailableVarList, {
  useGetNodesAvailableVarList,
} from '../use-nodes-available-var-list'

const mockGetTreeLeafNodes = vi.hoisted(() => vi.fn())
const mockGetBeforeNodesInSameBranchIncludeParent = vi.hoisted(() => vi.fn())
const mockGetNodeAvailableVars = vi.hoisted(() => vi.fn())
const mockFlowType = vi.hoisted(() => ({
  value: undefined as FlowType | undefined,
}))

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

vi.mock('@/app/components/workflow/hooks-store/store', () => ({
  useHooksStore: (selector: (state: { configsMap?: { flowType?: FlowType } }) => unknown) =>
    selector({
      configsMap: {
        flowType: mockFlowType.value,
      },
    }),
}))

const createNode = (overrides: Partial<Node> = {}): Node =>
  ({
    id: 'node-1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: BlockEnum.LLM,
      title: 'Node',
      desc: '',
    },
    ...overrides,
  }) as Node

const outputVars: NodeOutPutVar[] = [
  {
    nodeId: 'vars-node',
    title: 'Vars',
    vars: [
      {
        variable: 'name',
        type: VarType.string,
      },
    ] satisfies Var[],
  },
]

const outputVarsWithSystemVars: NodeOutPutVar[] = [
  {
    nodeId: 'vars-node',
    title: 'Vars',
    vars: [
      {
        variable: 'answer',
        type: VarType.string,
      },
      {
        variable: 'sys.files',
        type: VarType.arrayFile,
      },
    ] satisfies Var[],
  },
  {
    nodeId: 'global',
    title: 'SYSTEM',
    vars: [
      {
        variable: 'sys.user_id',
        type: VarType.string,
      },
    ] satisfies Var[],
  },
]

describe('useNodesAvailableVarList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowType.value = undefined
    globalThis.history.pushState({}, '', '/')
    useSnippetDraftStore.getState().reset()
    mockGetBeforeNodesInSameBranchIncludeParent.mockImplementation((nodeId: string) => [
      createNode({ id: `before-${nodeId}` }),
    ])
    mockGetTreeLeafNodes.mockImplementation((nodeId: string) => [
      createNode({ id: `leaf-${nodeId}` }),
    ])
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

    const { result } = renderHook(() =>
      useNodesAvailableVarList([loopNode, childNode], {
        filterVar,
        hideEnv: true,
        hideChatVar: true,
      }),
    )

    expect(mockGetBeforeNodesInSameBranchIncludeParent).toHaveBeenCalledWith('loop-1')
    expect(mockGetBeforeNodesInSameBranchIncludeParent).toHaveBeenCalledWith('child-1')
    expect(result.current['loop-1']?.availableNodes.map((node) => node.id)).toEqual([
      'before-loop-1',
      'loop-1',
    ])
    expect(result.current['child-1']?.availableVars).toEqual(outputVars)
    expect(mockGetNodeAvailableVars).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentNode: loopNode,
        isChatMode: true,
        filterVar,
        hideEnv: true,
        hideChatVar: true,
      }),
    )
  })

  it('adds snippet input fields as virtual start variables on snippet canvases', () => {
    globalThis.history.pushState({}, '', '/snippets/snippet-1/orchestrate')
    useSnippetDraftStore.getState().setInputFields([
      {
        type: PipelineInputVarType.textInput,
        label: 'Topic',
        variable: 'topic',
        required: true,
      },
    ])

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(() =>
      useNodesAvailableVarList([currentNode], {
        filterVar: () => true,
      }),
    )

    expect(result.current['node-a']?.availableNodes[0]).toEqual(
      expect.objectContaining({
        id: 'start',
        data: expect.objectContaining({
          type: BlockEnum.Start,
        }),
      }),
    )
    expect(result.current['node-a']?.availableVars[0]).toEqual(
      expect.objectContaining({
        nodeId: 'start',
        isStartNode: true,
        vars: [
          expect.objectContaining({
            variable: 'topic',
            type: VarType.string,
          }),
        ],
      }),
    )
  })

  it('filters system variables on snippet canvases', () => {
    globalThis.history.pushState({}, '', '/snippets/snippet-1/orchestrate')
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(() =>
      useNodesAvailableVarList([currentNode], {
        filterVar: () => true,
      }),
    )

    expect(result.current['node-a']?.availableVars).toEqual([
      {
        nodeId: 'vars-node',
        title: 'Vars',
        vars: [
          {
            variable: 'answer',
            type: VarType.string,
          },
        ],
      },
    ])
  })

  it('keeps system variables outside snippet canvases', () => {
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(() =>
      useNodesAvailableVarList([currentNode], {
        filterVar: () => true,
      }),
    )

    expect(result.current['node-a']?.availableVars).toEqual(outputVarsWithSystemVars)
  })

  it('filters system variables when the current flow is a snippet', () => {
    mockFlowType.value = FlowType.snippet
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(() =>
      useNodesAvailableVarList([currentNode], {
        filterVar: () => true,
      }),
    )

    expect(result.current['node-a']?.availableVars).toEqual([
      {
        nodeId: 'vars-node',
        title: 'Vars',
        vars: [
          {
            variable: 'answer',
            type: VarType.string,
          },
        ],
      },
    ])
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
    expect(leafMap['node-a']?.availableNodes.map((node) => node.id)).toEqual(['leaf-node-a'])
    expect(manualMap['node-b']?.availableNodes).toBe(passedInAvailableNodes)
  })
})
