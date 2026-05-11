import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import {
  getKnowledgeBaseValidationIssue,
  getKnowledgeBaseValidationMessage,
} from './utils'

const metaData = genNodeMetaData({
  sort: 3.1,
  type: BlockEnum.KnowledgeBase,
  isRequired: true,
  isUndeletable: true,
  isSingleton: true,
  isTypeFixed: true,
})
const nodeDefault: NodeDefault<KnowledgeBaseNodeType> = {
  metaData,
  defaultValue: {
    index_chunk_variable_selector: [],
    keyword_number: 10,
    retrieval_model: {
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    },
  },
  checkValid(payload, t) {
    const issue = getKnowledgeBaseValidationIssue(payload)
    if (issue)
      return { isValid: false, errorMessage: getKnowledgeBaseValidationMessage(issue, t) }

    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
