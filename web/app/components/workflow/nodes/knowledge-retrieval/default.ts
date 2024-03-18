import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

import { RETRIEVE_TYPE } from '@/types/app'

const nodeDefault: NodeDefault<KnowledgeRetrievalNodeType> = {
  defaultValue: {
    query_variable_selector: [],
    dataset_ids: [],
    retrieval_mode: RETRIEVE_TYPE.oneWay,
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.Answer)
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: KnowledgeRetrievalNodeType) {
    let isValid = true
    let errorMessages = ''
    if (payload.type) {
      isValid = true
      errorMessages = ''
    }
    return {
      isValid,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
