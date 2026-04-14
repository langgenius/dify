import type { CommonNodeType, Node, ToolWithProvider } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { workflowNodesAction } from '@/app/components/goto-anything/actions/workflow-nodes'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '../../types'
import { useWorkflowSearch } from '../use-workflow-search'

const mockHandleNodeSelect = vi.hoisted(() => vi.fn())
const runtimeNodes = vi.hoisted(() => [] as Node[])

vi.mock('reactflow', () => ({
  useNodes: () => runtimeNodes,
}))

vi.mock('../use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({
    data: [{
      id: 'provider-1',
      icon: 'tool-icon',
      tools: [],
    }] satisfies Partial<ToolWithProvider>[],
  }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))

const createNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.LLM,
    title: 'Writer',
    desc: 'Draft content',
  } as CommonNodeType,
  ...overrides,
})

describe('useWorkflowSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeNodes.length = 0
    workflowNodesAction.searchFn = undefined
  })

  it('registers workflow node search results with tool icons and llm metadata scoring', async () => {
    runtimeNodes.push(
      createNode({
        id: 'llm-1',
        data: {
          type: BlockEnum.LLM,
          title: 'Writer',
          desc: 'Draft content',
          model: {
            provider: 'openai',
            name: 'gpt-4o',
            mode: 'chat',
          },
        } as CommonNodeType,
      }),
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: 'Google Search',
          desc: 'Search the web',
          provider_type: CollectionType.builtIn,
          provider_id: 'provider-1',
        } as CommonNodeType,
      }),
      createNode({
        id: 'internal-start',
        data: {
          type: BlockEnum.IterationStart,
          title: 'Internal Start',
          desc: '',
        } as CommonNodeType,
      }),
    )

    const { unmount } = renderHook(() => useWorkflowSearch())

    const llmResults = await workflowNodesAction.search('', 'gpt')
    expect(llmResults.map(item => item.id)).toEqual(['llm-1'])
    expect(llmResults[0]?.title).toBe('Writer')

    const toolResults = await workflowNodesAction.search('', 'search')
    expect(toolResults.map(item => item.id)).toEqual(['tool-1'])
    expect(toolResults[0]?.description).toBe('Search the web')

    unmount()

    expect(workflowNodesAction.searchFn).toBeUndefined()
  })

  it('binds the node selection listener to handleNodeSelect', () => {
    const { unmount } = renderHook(() => useWorkflowSearch())

    act(() => {
      document.dispatchEvent(new CustomEvent('workflow:select-node', {
        detail: {
          nodeId: 'node-42',
          focus: false,
        },
      }))
    })

    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-42')

    unmount()
  })
})
