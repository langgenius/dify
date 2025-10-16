import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FullTextSearch,
  HybridSearch,
  VectorSearch,
} from '@/app/components/base/icons/src/vender/knowledge'
import {
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import type {
  HybridSearchModeOption,
  Option,
} from './type'

export const useRetrievalSetting = (indexMethod?: IndexMethodEnum) => {
  const { t } = useTranslation()
  const VectorSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.semantic,
      icon: VectorSearch as any,
      title: t('dataset.retrieval.semantic_search.title'),
      description: t('dataset.retrieval.semantic_search.description'),
      effectColor: 'purple',
    }
  }, [t])
  const FullTextSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.fullText,
      icon: FullTextSearch as any,
      title: t('dataset.retrieval.full_text_search.title'),
      description: t('dataset.retrieval.full_text_search.description'),
      effectColor: 'purple',
    }
  }, [t])
  const HybridSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.hybrid,
      icon: HybridSearch as any,
      title: t('dataset.retrieval.hybrid_search.title'),
      description: t('dataset.retrieval.hybrid_search.description'),
      effectColor: 'purple',
    }
  }, [t])
  const InvertedIndexOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.keywordSearch,
      icon: HybridSearch as any,
      title: t('dataset.retrieval.keyword_search.title'),
      description: t('dataset.retrieval.keyword_search.description'),
      effectColor: 'purple',
    }
  }, [t])

  const WeightedScoreModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.WeightedScore,
      title: t('dataset.weightedScore.title'),
      description: t('dataset.weightedScore.description'),
    }
  }, [t])
  const RerankModelModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.RerankingModel,
      title: t('common.modelProvider.rerankModel.key'),
      description: t('common.modelProvider.rerankModel.tip'),
    }
  }, [t])

  return useMemo(() => ({
    options: indexMethod === IndexMethodEnum.ECONOMICAL ? [
      InvertedIndexOption,
    ] : [
      VectorSearchOption,
      FullTextSearchOption,
      HybridSearchOption,
    ],
    hybridSearchModeOptions: [
      WeightedScoreModeOption,
      RerankModelModeOption,
    ],
  }), [
    VectorSearchOption,
    FullTextSearchOption,
    HybridSearchOption,
    InvertedIndexOption,
    indexMethod,
    WeightedScoreModeOption,
    RerankModelModeOption,
  ])
}
