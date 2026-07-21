import type { Node, NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import useAvailableVarList from '../use-available-var-list'

const mockGetTreeLeafNodes = vi.hoisted(() => vi.fn())
const mockGetBeforeNodesInSameBranchIncludeParent = vi.hoisted(() => vi.fn())
const mockGetNodeById = vi.hoisted(() => vi.fn())
const mockGetNodeAvailableVars = vi.hoisted(() => vi.fn())
const mockFlowType = vi.hoisted(() => ({
  value: undefined as FlowType | undefined,
}))

vi.mock('@/app/components/snippets/draft-store', () => ({
  useSnippetDraftStore: (selector: (state: { inputFields: unknown[] }) => unknown) =>
    selector({ inputFields: [] }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => true,
  useWorkflow: () => ({
    getTreeLeafNodes: mockGetTreeLeafNodes,
    getBeforeNodesInSameBranchIncludeParent: mockGetBeforeNodesInSameBranchIncludeParent,
    getNodeById: mockGetNodeById,
  }),
  useWorkflowVariables: () => ({
    getNodeAvailableVars: mockGetNodeAvailableVars,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { ragPipelineVariables: unknown[] }) => unknown) =>
    selector({ ragPipelineVariables: [] }),
}))

vi.mock('@/app/components/workflow/hooks-store/store', () => ({
  useHooksStore: (selector: (state: { configsMap?: { flowType?: FlowType } }) => unknown) =>
    selector({
      configsMap: {
        flowType: mockFlowType.value,
      },
    }),
}))

vi.mock('../use-node-info', () => ({
  default: () => ({
    parentNode: null,
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

describe('useAvailableVarList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlowType.value = undefined
    globalThis.history.pushState({}, '', '/')
    mockGetBeforeNodesInSameBranchIncludeParent.mockReturnValue([createNode({ id: 'before-node' })])
    mockGetTreeLeafNodes.mockReturnValue([createNode({ id: 'leaf-node' })])
    mockGetNodeById.mockReturnValue(createNode({ id: 'node-1' }))
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)
  })

  it('filters system variables on snippet canvases', () => {
    globalThis.history.pushState({}, '', '/snippets/snippet-1/orchestrate')

    const { result } = renderHook(() =>
      useAvailableVarList('node-1', {
        filterVar: () => true,
      }),
    )

    expect(result.current.availableVars).toEqual([
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
    const { result } = renderHook(() =>
      useAvailableVarList('node-1', {
        filterVar: () => true,
      }),
    )

    expect(result.current.availableVars).toEqual(outputVarsWithSystemVars)
  })

  it('filters system variables when the current flow is a snippet', () => {
    mockFlowType.value = FlowType.snippet

    const { result } = renderHook(() =>
      useAvailableVarList('node-1', {
        filterVar: () => true,
      }),
    )

    expect(result.current.availableVars).toEqual([
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
})
