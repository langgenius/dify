import type { Node, NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderWorkflowHook as renderHook } from '../../../../__tests__/workflow-test-env'
import useAvailableVarList from '../use-available-var-list'

const mockGetTreeLeafNodes = vi.hoisted(() => vi.fn())
const mockGetBeforeNodesInSameBranchIncludeParent = vi.hoisted(() => vi.fn())
const mockGetNodeById = vi.hoisted(() => vi.fn())
const mockGetNodeAvailableVars = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/snippets/draft-store', () => ({
  useSnippetDraftStore: (selector: (state: { inputFields: unknown[] }) => unknown) =>
    selector({ inputFields: [] }),
}))

vi.mock('../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow')>()

  return {
    ...actual,

    useWorkflow: () => ({
      getTreeLeafNodes: mockGetTreeLeafNodes,
      getBeforeNodesInSameBranchIncludeParent: mockGetBeforeNodesInSameBranchIncludeParent,
      getNodeById: mockGetNodeById,
    }),
  }
})

vi.mock('../../../../hooks/use-workflow-variables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow-variables')>()

  return {
    ...actual,
    useWorkflowVariables: () => ({
      getNodeAvailableVars: mockGetNodeAvailableVars,
    }),
  }
})

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
    mockGetBeforeNodesInSameBranchIncludeParent.mockReturnValue([createNode({ id: 'before-node' })])
    mockGetTreeLeafNodes.mockReturnValue([createNode({ id: 'leaf-node' })])
    mockGetNodeById.mockReturnValue(createNode({ id: 'node-1' }))
    mockGetNodeAvailableVars.mockReturnValue(outputVarsWithSystemVars)
  })

  it('filters system variables on snippet canvases', () => {
    const { result } = renderHook(
      () =>
        useAvailableVarList('node-1', {
          filterVar: () => true,
        }),
      { resource: { kind: 'snippet', snippetId: 'snippet-1' } },
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
    const { result } = renderHook(
      () =>
        useAvailableVarList('node-1', {
          filterVar: () => true,
        }),
      { resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' } },
    )

    expect(result.current.availableVars).toEqual(outputVarsWithSystemVars)
  })
})
