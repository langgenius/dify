import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { useRagPipelineSearch } from '../use-rag-pipeline-search'

const mockNodes: Array<{ id: string, data: Record<string, unknown> }> = []
vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: () => mockNodes,
}))

const mockHandleNodeSelect = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({
  useGetToolIcon: () => () => null,
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => null,
}))

type MockSearchResult = {
  title: string
  type: string
  description?: string
  metadata?: { nodeId: string }
}

const mockRagPipelineNodesAction = vi.hoisted(() => {
  return { searchFn: undefined as undefined | ((query: string) => MockSearchResult[]) }
})
vi.mock('@/app/components/goto-anything/actions/rag-pipeline-nodes', () => ({
  ragPipelineNodesAction: mockRagPipelineNodesAction,
}))

const mockCleanupListener = vi.fn()
vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  setupNodeSelectionListener: () => mockCleanupListener,
}))

describe('useRagPipelineSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes.length = 0
    mockRagPipelineNodesAction.searchFn = undefined
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook lifecycle', () => {
    it('should return null', () => {
      const { result } = renderHook(() => useRagPipelineSearch())
      expect(result.current).toBeNull()
    })

    it('should register search function when nodes exist', () => {
      mockNodes.push({
        id: 'node-1',
        data: { type: BlockEnum.LLM, title: 'LLM Node', desc: '' },
      })

      renderHook(() => useRagPipelineSearch())

      expect(mockRagPipelineNodesAction.searchFn).toBeDefined()
    })

    it('should not register search function when no nodes', () => {
      renderHook(() => useRagPipelineSearch())

      expect(mockRagPipelineNodesAction.searchFn).toBeUndefined()
    })

    it('should cleanup search function on unmount', () => {
      mockNodes.push({
        id: 'node-1',
        data: { type: BlockEnum.Start, title: 'Start', desc: '' },
      })

      const { unmount } = renderHook(() => useRagPipelineSearch())

      expect(mockRagPipelineNodesAction.searchFn).toBeDefined()

      unmount()

      expect(mockRagPipelineNodesAction.searchFn).toBeUndefined()
    })

    it('should setup node selection listener', () => {
      const { unmount } = renderHook(() => useRagPipelineSearch())

      unmount()

      expect(mockCleanupListener).toHaveBeenCalled()
    })
  })

  describe('search functionality', () => {
    beforeEach(() => {
      mockNodes.push(
        {
          id: 'node-1',
          data: { type: BlockEnum.LLM, title: 'GPT Model', desc: 'Language model' },
        },
        {
          id: 'node-2',
          data: { type: BlockEnum.KnowledgeRetrieval, title: 'Knowledge Base', desc: 'Search knowledge', dataset_ids: ['ds1', 'ds2'] },
        },
        {
          id: 'node-3',
          data: { type: BlockEnum.Tool, title: 'Web Search', desc: '', tool_description: 'Search the web', tool_label: 'WebSearch' },
        },
        {
          id: 'node-4',
          data: { type: BlockEnum.Start, title: 'Start Node', desc: 'Pipeline entry' },
        },
      )
    })

    it('should find nodes by title', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('GPT')

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].title).toBe('GPT Model')
    })

    it('should find nodes by type', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn(BlockEnum.LLM)

      expect(results.some(r => r.title === 'GPT Model')).toBe(true)
    })

    it('should find nodes by description', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('knowledge')

      expect(results.some(r => r.title === 'Knowledge Base')).toBe(true)
    })

    it('should return all nodes when search term is empty', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('')

      expect(results.length).toBe(4)
    })

    it('should sort by alphabetical order when no search term', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('')
      const titles = results.map(r => r.title)

      const sortedTitles = [...titles].sort((a, b) => a.localeCompare(b))
      expect(titles).toEqual(sortedTitles)
    })

    it('should sort by relevance score when search term provided', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('Search')

      expect(results[0].title).toBe('Web Search')
    })

    it('should return empty array when no nodes match', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('nonexistent-xyz-12345')

      expect(results).toEqual([])
    })

    it('should enhance Tool node description from tool_description', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('web')

      const toolResult = results.find(r => r.title === 'Web Search')
      expect(toolResult).toBeDefined()
      expect(toolResult?.description).toContain('Search the web')
    })

    it('should include metadata with nodeId', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('Start')

      const startResult = results.find(r => r.title === 'Start Node')
      expect(startResult?.metadata?.nodeId).toBe('node-4')
    })

    it('should set result type as workflow-node', () => {
      renderHook(() => useRagPipelineSearch())

      const searchFn = mockRagPipelineNodesAction.searchFn!
      const results = searchFn('Start')

      expect(results[0].type).toBe('workflow-node')
    })
  })
})
