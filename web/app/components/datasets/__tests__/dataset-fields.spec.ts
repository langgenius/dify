import {
  toChunkingMode,
  toCreationDataSourceType,
  toIconInfo,
  toRetrievalConfig,
  toSummaryIndexSetting,
} from '../dataset-fields'

describe('dataset fields', () => {
  it('keeps chunk structures the console renders', () => {
    expect(toChunkingMode('hierarchical_model')).toBe('hierarchical_model')
    expect(toChunkingMode('graph_model')).toBeUndefined()
    expect(toChunkingMode(null)).toBeUndefined()
  })

  it('keeps only the classic creation data sources', () => {
    expect(toCreationDataSourceType('notion_import')).toBe('notion_import')
    expect(toCreationDataSourceType('online_drive')).toBeUndefined()
  })

  it('reads an icon only when one was chosen', () => {
    expect(
      toIconInfo({ icon: '📙', icon_type: 'emoji', icon_background: '#FFF', icon_url: null }),
    ).toEqual({ icon: '📙', icon_type: 'emoji', icon_background: '#FFF', icon_url: undefined })
    expect(toIconInfo({ icon: null, icon_type: 'emoji' })).toBeUndefined()
    expect(toIconInfo({ icon: 'file-1', icon_type: 'svg' })).toBeUndefined()
    expect(toIconInfo(undefined)).toBeUndefined()
  })

  it('leaves unset summary settings unset', () => {
    expect(toSummaryIndexSetting({ enable: true, model_name: null })).toEqual({
      enable: true,
      model_name: undefined,
      model_provider_name: undefined,
      summary_prompt: undefined,
    })
  })

  describe('toRetrievalConfig', () => {
    const retrieval = {
      search_method: 'hybrid_search',
      reranking_enable: true,
      top_k: 4,
      score_threshold_enabled: false,
    } as const

    it('reads unset reranking models as no model selected', () => {
      expect(toRetrievalConfig(retrieval)).toEqual({
        ...retrieval,
        reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
        score_threshold: undefined,
        reranking_mode: undefined,
        weights: undefined,
      })
    })

    it('keeps weighted scores only when both weights were stored', () => {
      const weights = {
        weight_type: 'customized',
        vector_setting: { vector_weight: 0.7, embedding_model_name: 'embed' },
        keyword_setting: { keyword_weight: 0.3 },
      }

      expect(
        toRetrievalConfig({ ...retrieval, reranking_mode: 'weighted_score', weights }),
      ).toMatchObject({
        reranking_mode: 'weighted_score',
        weights: {
          weight_type: 'customized',
          vector_setting: {
            vector_weight: 0.7,
            embedding_provider_name: '',
            embedding_model_name: 'embed',
          },
          keyword_setting: { keyword_weight: 0.3 },
        },
      })
      expect(
        toRetrievalConfig({ ...retrieval, weights: { ...weights, keyword_setting: {} } }).weights,
      ).toBeUndefined()
      expect(
        toRetrievalConfig({ ...retrieval, weights: { ...weights, weight_type: null } }).weights
          ?.weight_type,
      ).toBe('customized')
    })
  })
})
