import type { SearchResult } from '../types'
import { ragPipelineNodesAction } from '../rag-pipeline-nodes'
import { workflowNodesAction } from '../workflow-nodes'

describe('workflowNodesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowNodesAction.searchFn = undefined
  })

  it('should return an empty result when no workflow search function is registered', async () => {
    await expect(workflowNodesAction.search('@node llm', 'llm', 'en')).resolves.toEqual([])
  })

  it('should delegate to the injected workflow search function', async () => {
    const results: SearchResult[] = [
      { id: 'workflow-node-1', title: 'LLM', type: 'workflow-node', data: {} as never },
    ]
    workflowNodesAction.searchFn = vi.fn().mockReturnValue(results)

    await expect(workflowNodesAction.search('@node llm', 'llm', 'en')).resolves.toEqual(results)
    expect(workflowNodesAction.searchFn).toHaveBeenCalledWith('llm')
  })

  it('should warn and return an empty list when workflow node search throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    workflowNodesAction.searchFn = vi.fn(() => {
      throw new Error('failed')
    })

    await expect(workflowNodesAction.search('@node llm', 'llm', 'en')).resolves.toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('Workflow nodes search failed:', expect.any(Error))

    warnSpy.mockRestore()
  })
})

describe('ragPipelineNodesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ragPipelineNodesAction.searchFn = undefined
  })

  it('should return an empty result when no rag pipeline search function is registered', async () => {
    await expect(ragPipelineNodesAction.search('@node embed', 'embed', 'en')).resolves.toEqual([])
  })

  it('should delegate to the injected rag pipeline search function', async () => {
    const results: SearchResult[] = [
      { id: 'rag-node-1', title: 'Retriever', type: 'workflow-node', data: {} as never },
    ]
    ragPipelineNodesAction.searchFn = vi.fn().mockReturnValue(results)

    await expect(ragPipelineNodesAction.search('@node retrieve', 'retrieve', 'en')).resolves.toEqual(results)
    expect(ragPipelineNodesAction.searchFn).toHaveBeenCalledWith('retrieve')
  })

  it('should warn and return an empty list when rag pipeline node search throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ragPipelineNodesAction.searchFn = vi.fn(() => {
      throw new Error('failed')
    })

    await expect(ragPipelineNodesAction.search('@node retrieve', 'retrieve', 'en')).resolves.toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('RAG pipeline nodes search failed:', expect.any(Error))

    warnSpy.mockRestore()
  })
})
