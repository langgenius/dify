import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWorkflowDraft, syncWorkflowDraft } from './workflow'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getConsoleV2: vi.fn(),
  post: vi.fn(),
  postConsoleV2: vi.fn(),
}))

vi.mock('./base', () => ({
  get: (...args: unknown[]) => mocks.get(...args),
  getConsoleV2: (...args: unknown[]) => mocks.getConsoleV2(...args),
  post: (...args: unknown[]) => mocks.post(...args),
  postConsoleV2: (...args: unknown[]) => mocks.postConsoleV2(...args),
}))

vi.mock('./client', () => ({
  consoleClient: {},
}))

const draftParams = {
  graph: { nodes: [], edges: [] },
  features: {},
  environment_variables: [],
  conversation_variables: [],
}

describe('workflow draft service routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({})
    mocks.getConsoleV2.mockResolvedValue({})
    mocks.post.mockResolvedValue({})
    mocks.postConsoleV2.mockResolvedValue({})
  })

  it('should use API v2 for app workflow draft reads and writes', async () => {
    await fetchWorkflowDraft('/apps/app-id/workflows/draft')
    await syncWorkflowDraft({
      url: '/apps/app-id/workflows/draft',
      params: draftParams,
    })

    expect(mocks.getConsoleV2).toHaveBeenCalledWith('/apps/app-id/workflows/draft', {}, { silent: true })
    expect(mocks.postConsoleV2).toHaveBeenCalledWith(
      '/apps/app-id/workflows/draft',
      {
        body: draftParams,
      },
      { silent: true },
    )
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('should keep RAG pipeline draft reads and writes on the legacy console API', async () => {
    await fetchWorkflowDraft('/rag/pipelines/pipeline-id/workflows/draft')
    await syncWorkflowDraft({
      url: '/rag/pipelines/pipeline-id/workflows/draft',
      params: draftParams,
    })

    expect(mocks.get).toHaveBeenCalledWith('/rag/pipelines/pipeline-id/workflows/draft', {}, { silent: true })
    expect(mocks.post).toHaveBeenCalledWith(
      '/rag/pipelines/pipeline-id/workflows/draft',
      {
        body: draftParams,
      },
      { silent: true },
    )
    expect(mocks.getConsoleV2).not.toHaveBeenCalled()
    expect(mocks.postConsoleV2).not.toHaveBeenCalled()
  })
})
