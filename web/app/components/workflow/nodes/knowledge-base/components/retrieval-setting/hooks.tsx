import { useMemo } from 'react'
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

export const useRetrievalSetting = (indexMethod: IndexMethodEnum) => {
  const VectorSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.semantic,
      icon: VectorSearch as any,
      title: 'Vector Search',
      description: 'Generate query embeddings and search for the text chunk most similar to its vector representation.',
      effectColor: 'purple',
    }
  }, [])
  const FullTextSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.fullText,
      icon: FullTextSearch as any,
      title: 'Full-Text Search',
      description: 'Execute full-text search and vector searches simultaneously, re-rank to select the best match for the user\'s query. Users can choose to set weights or configure to a Rerank model.',
      effectColor: 'purple',
    }
  }, [])
  const HybridSearchOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.hybrid,
      icon: HybridSearch as any,
      title: 'Hybrid Search',
      description: 'Execute full-text search and vector searches simultaneously, re-rank to select the best match for the user\'s query. Users can choose to set weights or configure to a Rerank model.',
      effectColor: 'purple',
    }
  }, [])
  const InvertedIndexOption: Option = useMemo(() => {
    return {
      id: RetrievalSearchMethodEnum.invertedIndex,
      icon: HybridSearch as any,
      title: 'Inverted Index',
      description: 'Use inverted index to search for the most relevant text chunks.',
      effectColor: 'purple',
    }
  }, [])

  const WeightedScoreModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.WeightedScore,
      title: 'Weighted Score',
      description: 'By adjusting the weights assigned, this rerank strategy determines whether to prioritize semantic or keyword matching.',
    }
  }, [])
  const RerankModelModeOption: HybridSearchModeOption = useMemo(() => {
    return {
      id: HybridSearchModeEnum.RerankingModel,
      title: 'Rerank Model',
      description: 'Rerank model will reorder the candidate document list based on the semantic match with user query, improving the results of semantic ranking.',
    }
  }, [])

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
