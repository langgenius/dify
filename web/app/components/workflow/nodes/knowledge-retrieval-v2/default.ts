import type { TFunction } from 'i18next'
import type { NodeDefault } from '../../types'
import type { KnowledgeRetrievalV2NodeType } from './types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { KNOWLEDGE_RETRIEVAL_V2_OUTPUT_STRUCT } from './constants'

const metaData = genNodeMetaData({
  sort: 2.05,
  type: BlockEnum.KnowledgeRetrievalV2,
})

const nodeDefault: NodeDefault<KnowledgeRetrievalV2NodeType> = {
  metaData,
  defaultValue: {
    control_space_ids: [],
    metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
    query_attachment_selector: [],
    query_variable_selector: [],
    score_threshold: null,
    top_n: 10,
  },
  checkValid(payload, t: TFunction<'workflow'>) {
    let errorMessage = ''
    if (!payload.query_variable_selector?.length) {
      errorMessage = t(($) => $['errorMsg.fieldRequired'], {
        ns: 'workflow',
        field: t(($) => $['nodes.knowledgeRetrievalV2.queryText'], { ns: 'workflow' }),
      })
    } else if (!payload.control_space_ids?.length) {
      errorMessage = t(($) => $['errorMsg.fieldRequired'], {
        ns: 'workflow',
        field: t(($) => $['nodes.knowledgeRetrievalV2.knowledgeSpaces'], { ns: 'workflow' }),
      })
    }

    return { isValid: !errorMessage, errorMessage }
  },
  getOutputVars: () => KNOWLEDGE_RETRIEVAL_V2_OUTPUT_STRUCT,
}

export default nodeDefault
