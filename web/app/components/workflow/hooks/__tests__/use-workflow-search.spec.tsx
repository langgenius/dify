import type { Node } from '../../types'
import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowHook as renderHook } from '../../__tests__/workflow-test-env'
import { findWorkflowNodes } from '../../goto-anything-search'
import { BlockEnum } from '../../types'
import { selectWorkflowNode } from '../../utils/node-navigation'
import { useWorkflowSearch } from '../use-workflow-search'

let runtimeNodes: Node[] = []

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createToolProviderFixture } = await import('@/test/console/tool-provider-fixture')
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
      'workspaces.current.tools.builtin.get': async () => [
        createToolProviderFixture({ id: 'provider-1', icon: 'tool-icon' }),
      ],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

describe('useWorkflowSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeNodes = []
  })

  it('registers workflow node search results with llm metadata scoring', async () => {
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
        },
      }),
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: 'Google Search',
          desc: 'Search the web',
          provider_type: CollectionType.builtIn,
          provider_id: 'provider-1',
        },
      }),
      createNode({
        id: 'internal-start',
        data: {
          type: BlockEnum.IterationStart,
          title: 'Internal Start',
          desc: '',
        },
      }),
    )

    const { unmount } = renderHook(() => useWorkflowSearch(), { nodes: runtimeNodes })

    const llmResults = findWorkflowNodes('gpt')
    expect(llmResults.map((item) => item.id)).toEqual(['llm-1'])
    expect(llmResults[0]?.title).toBe('Writer')

    const toolResults = findWorkflowNodes('search')
    expect(toolResults.map((item) => item.id)).toEqual(['tool-1'])
    // description now includes nodeId suffix: "desc · nodeId"
    expect(toolResults[0]?.description).toBe('Search the web · tool-1')
    expect(findWorkflowNodes('internal')).toEqual([])

    unmount()

    expect(findWorkflowNodes('gpt')).toEqual([])
  })

  it('matches by node_id with highest priority scoring', async () => {
    runtimeNodes.push(
      createNode({
        id: '1721234567890',
        data: {
          type: BlockEnum.LLM,
          title: 'Writer',
          desc: 'Draft content',
        },
      }),
      createNode({
        id: 'other-node',
        data: {
          type: BlockEnum.LLM,
          title: '1721234567890', // title also matches the searchTerm
          desc: '',
        },
      }),
    )

    const { unmount } = renderHook(() => useWorkflowSearch(), { nodes: runtimeNodes })

    // Exact nodeId match (120pts) should rank higher than title exact match (100pts)
    const results = findWorkflowNodes('1721234567890')
    expect(results.map((item) => item.id)).toEqual(['1721234567890', 'other-node'])

    unmount()
  })

  it('matches by partial node_id', async () => {
    runtimeNodes.push(
      createNode({
        id: '1721234567890',
        data: {
          type: BlockEnum.LLM,
          title: 'Writer',
          desc: 'Draft content',
        },
      }),
    )

    const { unmount } = renderHook(() => useWorkflowSearch(), { nodes: runtimeNodes })

    // Prefix match
    const prefixResults = findWorkflowNodes('172123')
    expect(prefixResults.map((item) => item.id)).toEqual(['1721234567890'])

    // Partial match
    const partialResults = findWorkflowNodes('456')
    expect(partialResults.map((item) => item.id)).toEqual(['1721234567890'])

    unmount()
  })

  it('selects the requested graph node and stops listening after unmount', () => {
    const { result, unmount } = renderHook(
      () => {
        useWorkflowSearch()
        return useReactFlow()
      },
      { nodes: [createNode({ id: 'node-42' }), createNode({ id: 'other' })] },
    )
    act(() => selectWorkflowNode('node-42'))
    expect(result.current.getNode('node-42')?.data.selected).toBe(true)
    unmount()
    act(() => selectWorkflowNode('other'))
    expect(result.current.getNode('other')?.data.selected).not.toBe(true)
  })
})
