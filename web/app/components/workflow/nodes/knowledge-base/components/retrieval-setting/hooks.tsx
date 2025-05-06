import {
  FullTextSearch,
  HybridSearch,
  VectorSearch,
} from '@/app/components/base/icons/src/vender/knowledge'
import {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import type {
  HybridSearchModeOption,
  Option,
} from './type'

export const useRetrievalSetting = () => {
  const VectorSearchOption: Option = {
    id: RetrievalSearchMethodEnum.semantic,
    icon: VectorSearch as any,
    title: 'Vector Search',
    description: 'Generate query embeddings and search for the text chunk most similar to its vector representation.',
    effectColor: 'purple',
  }
  const FullTextSearchOption: Option = {
    id: RetrievalSearchMethodEnum.fullText,
    icon: FullTextSearch as any,
    title: 'Full-Text Search',
    description: 'Execute full-text search and vector searches simultaneously, re-rank to select the best match for the user\'s query. Users can choose to set weights or configure to a Rerank model.',
    effectColor: 'purple',
  }
  const HybridSearchOption: Option = {
    id: RetrievalSearchMethodEnum.hybrid,
    icon: HybridSearch as any,
    title: 'Hybrid Search',
    description: 'Execute full-text search and vector searches simultaneously, re-rank to select the best match for the user\'s query. Users can choose to set weights or configure to a Rerank model.',
    effectColor: 'purple',
  }

  const options = [
    VectorSearchOption,
    FullTextSearchOption,
    HybridSearchOption,
  ]

  const WeightedScoreModeOption: HybridSearchModeOption = {
    id: HybridSearchModeEnum.WeightedScore,
    title: 'Weighted Score',
    description: 'By adjusting the weights assigned, this rerank strategy determines whether to prioritize semantic or keyword matching.',
  }

  const RerankModelModeOption: HybridSearchModeOption = {
    id: HybridSearchModeEnum.RerankingModel,
    title: 'Rerank Model',
    description: 'Rerank model will reorder the candidate document list based on the semantic match with user query, improving the results of semantic ranking.',
  }

  const hybridSearchModeOptions = [
    WeightedScoreModeOption,
    RerankModelModeOption,
  ]

  return {
    options,
    hybridSearchModeOptions,
  }
}
