import { describe, expect, it, vi } from 'vite-plus/test'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { findRagPipelineNodes } from '../../goto-anything-search'
import { useRagPipelineSearch } from '../use-rag-pipeline-search'

vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({
  useGetToolIcon: () => () => null,
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => null,
}))

const renderSearch = (nodes: ReturnType<typeof createNode>[] = []) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '1.0' })
  seedModelProviderQueries(queryClient)
  return renderWorkflowCanvasHook(() => useRagPipelineSearch(), {
    queryClient,
    initialStoreState: { nodes },
  })
}

describe('useRagPipelineSearch', () => {
  describe('hook lifecycle', () => {
    it('should expose empty search results when no nodes exist', () => {
      const { unmount } = renderSearch()

      expect(findRagPipelineNodes('LLM')).toEqual([])

      unmount()
    })

    it('should cleanup search function on unmount', () => {
      const { unmount } = renderSearch([
        createNode({
          id: 'node-1',
          data: { type: BlockEnum.Start, title: 'Start', desc: '' },
        }),
      ])

      expect(findRagPipelineNodes('Start')).not.toEqual([])

      unmount()

      expect(findRagPipelineNodes('Start')).toEqual([])
    })
  })

  describe('search functionality', () => {
    const nodes = [
      createNode({
        id: 'node-1',
        data: { type: BlockEnum.LLM, title: 'GPT Model', desc: 'Language model' },
      }),
      createNode({
        id: 'node-2',
        data: {
          type: BlockEnum.KnowledgeRetrieval,
          title: 'Knowledge Base',
          desc: 'Search knowledge',
          dataset_ids: ['ds1', 'ds2'],
        },
      }),
      createNode({
        id: 'node-3',
        data: {
          type: BlockEnum.Tool,
          title: 'Web Search',
          desc: '',
          tool_description: 'Search the web',
          tool_label: 'WebSearch',
        },
      }),
      createNode({
        id: 'node-4',
        data: { type: BlockEnum.Start, title: 'Start Node', desc: 'Pipeline entry' },
      }),
    ]

    it('should find nodes by title', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes('GPT')

      expect(results.map((result) => result.id)).toEqual(['node-1'])
    })

    it('should find nodes by type', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes(BlockEnum.LLM)

      expect(results.some((r) => r.title === 'GPT Model')).toBe(true)
    })

    it('should sort by alphabetical order when no search term', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes('')
      const titles = results.map((r) => r.title)

      expect(titles).toEqual(['GPT Model', 'Knowledge Base', 'Start Node', 'Web Search'])
    })

    it('should sort by relevance score when search term provided', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes('Search')

      expect(results[0]!.title).toBe('Web Search')
    })

    it('should return empty array when no nodes match', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes('nonexistent-xyz-12345')

      expect(results).toEqual([])
    })

    it('should enhance Tool node description from tool_description', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes('web')

      const toolResult = results.find((r) => r.title === 'Web Search')
      expect(toolResult).toBeDefined()
      expect(toolResult?.description).toContain('Search the web')
    })

    it('should include metadata with nodeId', () => {
      renderSearch(nodes)

      const results = findRagPipelineNodes('Start')

      const startResult = results.find((r) => r.title === 'Start Node')
      expect(startResult?.type).toBe('workflow-node')
      expect(startResult).toMatchObject({ type: 'workflow-node', metadata: { nodeId: 'node-4' } })
    })
  })
})
