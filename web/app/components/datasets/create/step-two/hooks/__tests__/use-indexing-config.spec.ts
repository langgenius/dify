import { act } from '@testing-library/react'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType, useIndexingConfig } from '../use-indexing-config'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': async () => ({ data: [] }),
      'workspaces.current.defaultModel.get': async () => ({ data: null }),
    }),
  }
})

it('changes the default index technique when API-key availability changes', () => {
  const { result, rerender } = renderHook(
    (isAPIKeySet) => useIndexingConfig({ isAPIKeySet, hasSetIndexType: false }),
    { initialProps: false },
  )
  expect(result.current.indexType).toBe(IndexingType.ECONOMICAL)
  rerender(true)
  expect(result.current.getIndexingTechnique()).toBe(IndexingType.QUALIFIED)
  act(() => result.current.setIndexType(IndexingType.ECONOMICAL))
  expect(result.current.getIndexingTechnique()).toBe(IndexingType.ECONOMICAL)
})

it('preserves the persisted technique and retrieval configuration over defaults', () => {
  const retrievalConfig = {
    search_method: RETRIEVE_METHOD.fullText,
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 5,
    score_threshold_enabled: true,
    score_threshold: 0.8,
  }
  const embeddingModel = { provider: 'openai', model: 'text-embedding-3-small' }
  const { result, rerender } = renderHook(
    (isAPIKeySet) =>
      useIndexingConfig({
        isAPIKeySet,
        hasSetIndexType: true,
        initialIndexType: IndexingType.ECONOMICAL,
        initialEmbeddingModel: embeddingModel,
        initialRetrievalConfig: retrievalConfig,
      }),
    { initialProps: false },
  )
  rerender(true)
  expect(result.current.getIndexingTechnique()).toBe(IndexingType.ECONOMICAL)
  expect(result.current.embeddingModel).toEqual(embeddingModel)
  expect(result.current.retrievalConfig).toEqual(retrievalConfig)
})
