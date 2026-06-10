import { renderHook } from '@testing-library/react'
import {
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import { useSettingsDisplay } from '../use-settings-display'

describe('useSettingsDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The display map should expose translated labels for all index and retrieval settings.
  describe('Translations', () => {
    it('should return translated labels for each supported setting key', () => {
      const { result } = renderHook(() => useSettingsDisplay())

      expect(result.current[IndexMethodEnum.QUALIFIED]).toBe('datasetCreation.stepTwo.qualified')
      expect(result.current[IndexMethodEnum.ECONOMICAL]).toBe('datasetSettings.form.indexMethodEconomy')
      expect(result.current[RetrievalSearchMethodEnum.semantic]).toBe('dataset.retrieval.semantic_search.title')
      expect(result.current[RetrievalSearchMethodEnum.fullText]).toBe('dataset.retrieval.full_text_search.title')
      expect(result.current[RetrievalSearchMethodEnum.hybrid]).toBe('dataset.retrieval.hybrid_search.title')
      expect(result.current[RetrievalSearchMethodEnum.keywordSearch]).toBe('dataset.retrieval.keyword_search.title')
    })
  })
})
