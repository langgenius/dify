import type { SearchResult } from '../types'
import {
  findRagPipelineNodes,
  registerRagPipelineNodeSearch,
} from '@/app/components/rag-pipeline/goto-anything-search'
import {
  findWorkflowNodes,
  registerWorkflowNodeSearch,
} from '@/app/components/workflow/goto-anything-search'

describe('workflow node search registry', () => {
  it('registers, searches, and unregisters workflow nodes', () => {
    const results: SearchResult[] = [
      { id: 'workflow-node-1', title: 'LLM', type: 'workflow-node', data: {} as never },
    ]
    const search = vi.fn().mockReturnValue(results)
    const unregister = registerWorkflowNodeSearch(search)

    expect(findWorkflowNodes('llm')).toEqual(results)
    expect(search).toHaveBeenCalledWith('llm')

    unregister()

    expect(findWorkflowNodes('llm')).toEqual([])
  })
})

describe('RAG pipeline node search registry', () => {
  it('registers, searches, and unregisters RAG pipeline nodes', () => {
    const results: SearchResult[] = [
      { id: 'rag-node-1', title: 'Retriever', type: 'workflow-node', data: {} as never },
    ]
    const search = vi.fn().mockReturnValue(results)
    const unregister = registerRagPipelineNodeSearch(search)

    expect(findRagPipelineNodes('retrieve')).toEqual(results)
    expect(search).toHaveBeenCalledWith('retrieve')

    unregister()

    expect(findRagPipelineNodes('retrieve')).toEqual([])
  })
})
