import type { Node, NodeOutPutVar, Var } from '../../types'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { useSnippetDraftStore } from '@/app/components/snippets/draft-store'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { PipelineInputVarType } from '@/models/pipeline'
import { BlockEnum, VarType } from '../../types'
import useNodesAvailableVarList, {
  useGetNodesAvailableVarList,
} from '../use-nodes-available-var-list'

const mockGetTreeLeafNodes = vi.hoisted(() => vi.fn())
const mockGetBeforeNodesInSameBranchIncludeParent = vi.hoisted(() => vi.fn())
const mockGetNodeAvailableVars = vi.hoisted(() => vi.fn())
const mockFlowType = vi.hoisted(() => ({
  value: undefined as EditorResource['kind'] | undefined,
}))

vi.mock('../use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-workflow')>()

  return {
    ...actual,

    useWorkflow: () => ({
      getTreeLeafNodes: mockGetTreeLeafNodes,
      getBeforeNodesInSameBranchIncludeParent: mockGetBeforeNodesInSameBranchIncludeParent,
    }),
  }
})

vi.mock('../use-workflow-variables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-workflow-variables')>()

  return {
    ...actual,
    useWorkflowVariables: () => ({
      getNodeAvailableVars: mockGetNodeAvailableVars,
    }),
  }
})

vi.mock('@/app/components/workflow/hooks-store/store', () => ({
  useHooksStore: (
    selector: (state: { configsMap?: { resourceKind?: EditorResource['kind'] } }) => unknown,
  ) =>
    selector({
      configsMap: {
        resourceKind: mockFlowType.value,
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

    const { result } = renderHook(
      () =>
        useNodesAvailableVarList([loopNode, childNode], {
          filterVar,
          hideEnv: true,
          hideChatVar: true,
        }),
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
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
        isChatflow: true,
        filterVar,
        hideEnv: true,
        hideChatVar: true,
      }),
    )
  })

  it('adds snippet input fields as virtual start variables on snippet canvases', () => {
    useSnippetDraftStore.getState().setInputFields([
      {
        type: PipelineInputVarType.textInput,
        label: 'Topic',
        variable: 'topic',
        required: true,
      },
    ])

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(
      () =>
        useNodesAvailableVarList([currentNode], {
          filterVar: () => true,
        }),
      { resource: { kind: 'snippet', snippetId: 'snippet-1' } },
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
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(
      () =>
        useNodesAvailableVarList([currentNode], {
          filterVar: () => true,
        }),
      { resource: { kind: 'snippet', snippetId: 'snippet-1' } },
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

    const { result } = renderHook(
      () =>
        useNodesAvailableVarList([currentNode], {
          filterVar: () => true,
        }),
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    expect(result.current['node-a']?.availableVars).toEqual(outputVarsWithSystemVars)
  })

  it('filters system variables when the current flow is a snippet', () => {
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)

    const currentNode = createNode({ id: 'node-a' })

    const { result } = renderHook(
      () =>
        useNodesAvailableVarList([currentNode], {
          filterVar: () => true,
        }),
      { resource: { kind: 'snippet', snippetId: 'snippet-1' } },
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

    const { result } = renderHook(() => useGetNodesAvailableVarList(), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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

vi.mock('@/app/components/workflow/editor-resource/state', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/workflow/editor-resource/state')>()
  const { atom } = await import('jotai')
  return { ...actual, isChatflowAtom: atom(() => true) }
})
