import { BlockEnum } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'
import { RETRIEVE_TYPE } from '@/types/app'

export const mockData: KnowledgeRetrievalNodeType = {
  type: BlockEnum.KnowledgeRetrieval,
  desc: 'xxx',
  title: 'KnowledgeRetrieval',
  query_variable_selector: ['aaa', 'name'],
  dataset_ids: ['1'],
  retrieval_mode: RETRIEVE_TYPE.oneWay,
  multiple_retrieval_config: {
    top_k: 10,
    score_threshold: null,
    reranking_model: {
      provider: '',
      model: '',
    },
  },
}
