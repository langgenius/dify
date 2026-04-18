import { renderHook } from '@testing-library/react'
import {
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../../../types'
import { useRetrievalSetting } from '../hooks'

describe('useRetrievalSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The hook should switch between economical and qualified retrieval option sets.
  describe('Options', () => {
    it('should return semantic, full-text, and hybrid options for qualified indexing', () => {
      const { result } = renderHook(() => useRetrievalSetting(IndexMethodEnum.QUALIFIED))

      expect(result.current.options.map(option => option.id)).toEqual([
        RetrievalSearchMethodEnum.semantic,
        RetrievalSearchMethodEnum.fullText,
        RetrievalSearchMethodEnum.hybrid,
      ])
      expect(result.current.hybridSearchModeOptions.map(option => option.id)).toEqual([
        HybridSearchModeEnum.WeightedScore,
        HybridSearchModeEnum.RerankingModel,
      ])
    })

    it('should return only keyword search for economical indexing', () => {
      const { result } = renderHook(() => useRetrievalSetting(IndexMethodEnum.ECONOMICAL))

      expect(result.current.options.map(option => option.id)).toEqual([
        RetrievalSearchMethodEnum.keywordSearch,
      ])
    })
  })
})
