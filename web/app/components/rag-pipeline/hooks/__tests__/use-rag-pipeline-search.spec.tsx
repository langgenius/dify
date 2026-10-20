import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { findRagPipelineNodes } from '../../goto-anything-search'
import { useRagPipelineSearch } from '../use-rag-pipeline-search'

const mockNodes: Array<{ id: string; data: Record<string, unknown> }> = []
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

const mockCleanupListener = vi.fn()
vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  setupNodeSelectionListener: () => mockCleanupListener,
}))

describe('useRagPipelineSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('hook lifecycle', () => {
    it('should expose empty search results when no nodes exist', () => {
      const { unmount } = renderHook(() => useRagPipelineSearch())

      expect(findRagPipelineNodes('LLM')).toEqual([])

      unmount()
    })

    it('should cleanup search function on unmount', () => {
      mockNodes.push({
        id: 'node-1',
        data: { type: BlockEnum.Start, title: 'Start', desc: '' },
      })

      const { unmount } = renderHook(() => useRagPipelineSearch())

      expect(findRagPipelineNodes('Start')).not.toEqual([])

      unmount()

      expect(findRagPipelineNodes('Start')).toEqual([])
      expect(mockCleanupListener).toHaveBeenCalledOnce()
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
          data: {
            type: BlockEnum.KnowledgeRetrieval,
            title: 'Knowledge Base',
            desc: 'Search knowledge',
            dataset_ids: ['ds1', 'ds2'],
          },
        },
        {
          id: 'node-3',
          data: {
            type: BlockEnum.Tool,
            title: 'Web Search',
            desc: '',
            tool_description: 'Search the web',
            tool_label: 'WebSearch',
          },
        },
        {
          id: 'node-4',
          data: { type: BlockEnum.Start, title: 'Start Node', desc: 'Pipeline entry' },
        },
      )
    })

    it('should find nodes by title', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes('GPT')

      expect(results.map((result) => result.id)).toEqual(['node-1'])
    })

    it('should find nodes by type', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes(BlockEnum.LLM)

      expect(results.some((r) => r.title === 'GPT Model')).toBe(true)
    })

    it('should sort by alphabetical order when no search term', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes('')
      const titles = results.map((r) => r.title)

      expect(titles).toEqual(['GPT Model', 'Knowledge Base', 'Start Node', 'Web Search'])
    })

    it('should sort by relevance score when search term provided', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes('Search')

      expect(results[0]!.title).toBe('Web Search')
    })

    it('should return empty array when no nodes match', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes('nonexistent-xyz-12345')

      expect(results).toEqual([])
    })

    it('should enhance Tool node description from tool_description', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes('web')

      const toolResult = results.find((r) => r.title === 'Web Search')
      expect(toolResult).toBeDefined()
      expect(toolResult?.description).toContain('Search the web')
    })

    it('should include metadata with nodeId', () => {
      renderHook(() => useRagPipelineSearch())

      const results = findRagPipelineNodes('Start')

      const startResult = results.find((r) => r.title === 'Start Node')
      expect(startResult?.type).toBe('workflow-node')
      expect(startResult).toMatchObject({ type: 'workflow-node', metadata: { nodeId: 'node-4' } })
    })
  })
})
