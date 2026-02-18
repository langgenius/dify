import type {
  HybridSearchModeOption,
  Option,
} from './type'
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

export const useRetrievalSetting = (indexMethod?: IndexMethodEnum) => {
  const { t } = useTranslation()
  const VectorSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.semantic,
      icon: VectorSearch as any,
      title: t('retrieval.semantic_search.title', { ns: 'dataset' }),
      description: t('retrieval.semantic_search.description', { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])
  const FullTextSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.fullText,
      icon: FullTextSearch as any,
      title: t('retrieval.full_text_search.title', { ns: 'dataset' }),
      description: t('retrieval.full_text_search.description', { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])
  const HybridSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.hybrid,
      icon: HybridSearch as any,
      title: t('retrieval.hybrid_search.title', { ns: 'dataset' }),
      description: t('retrieval.hybrid_search.description', { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])
  const InvertedIndexOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.keywordSearch,
      icon: HybridSearch as any,
      title: t('retrieval.keyword_search.title', { ns: 'dataset' }),
      description: t('retrieval.keyword_search.description', { ns: 'dataset' }),
      effectColor: 'purple',
    }
  }, [t])

  const WeightedScoreModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.WeightedScore,
      title: t('weightedScore.title', { ns: 'dataset' }),
      description: t('weightedScore.description', { ns: 'dataset' }),
    }
  }, [t])
  const RerankModelModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.RerankingModel,
      title: t('modelProvider.rerankModel.key', { ns: 'common' }),
      description: t('modelProvider.rerankModel.tip', { ns: 'common' }),
    }
  }, [t])

  return useMemo(() => ({
    options: indexMethod === IndexMethodEnum.ECONOMICAL
      ? [
          InvertedIndexOption,
        ]
      : [
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
