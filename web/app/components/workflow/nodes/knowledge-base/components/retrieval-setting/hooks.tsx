import type { HybridSearchModeOption, Option } from './type'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HybridSearchModeEnum, IndexMethodEnum, RetrievalSearchMethodEnum } from '../../types'

export const useRetrievalSetting = (indexMethod?: IndexMethodEnum) => {
  const { t } = useTranslation(['common', 'dataset'])
  const VectorSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.semantic,
      iconClassName: 'i-custom-vender-knowledge-vector-search',
      title: t(($) => $['retrieval.semantic_search.title'], { ns: 'dataset' }),
      description: t(($) => $['retrieval.semantic_search.description'], { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])
  const FullTextSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.fullText,
      iconClassName: 'i-custom-vender-knowledge-full-text-search',
      title: t(($) => $['retrieval.full_text_search.title'], { ns: 'dataset' }),
      description: t(($) => $['retrieval.full_text_search.description'], { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])
  const HybridSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.hybrid,
      iconClassName: 'i-custom-vender-knowledge-hybrid-search',
      title: t(($) => $['retrieval.hybrid_search.title'], { ns: 'dataset' }),
      description: t(($) => $['retrieval.hybrid_search.description'], { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])
  const InvertedIndexOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.keywordSearch,
      iconClassName: 'i-custom-vender-knowledge-hybrid-search',
      title: t(($) => $['retrieval.keyword_search.title'], { ns: 'dataset' }),
      description: t(($) => $['retrieval.keyword_search.description'], { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])

  const WeightedScoreModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.WeightedScore,
      title: t(($) => $['weightedScore.title'], { ns: 'dataset' }),
      description: t(($) => $['weightedScore.description'], { ns: 'dataset' }),
    }
  }, [t])
  const RerankModelModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.RerankingModel,
      title: t(($) => $['modelProvider.rerankModel.key'], { ns: 'common' }),
      description: t(($) => $['modelProvider.rerankModel.tip'], { ns: 'common' }),
    }
  }, [t])

  return useMemo(
    () => ({
      options:
        indexMethod === IndexMethodEnum.ECONOMICAL
          ? [InvertedIndexOption]
          : [VectorSearchOption, FullTextSearchOption, HybridSearchOption],
      hybridSearchModeOptions: [WeightedScoreModeOption, RerankModelModeOption],
    }),
    [
      VectorSearchOption,
      FullTextSearchOption,
      HybridSearchOption,
      InvertedIndexOption,
      indexMethod,
      WeightedScoreModeOption,
      RerankModelModeOption,
    ],
  )
}
