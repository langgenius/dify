import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'
import { checkoutRerankModelConfigedInRetrievalSettings } from './utils'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
import { DATASET_DEFAULT } from '@/config'
import { RETRIEVE_TYPE } from '@/types/app'
const i18nPrefix = 'workflow'

const nodeDefault: NodeDefault<KnowledgeRetrievalNodeType> = {
  defaultValue: {
    query_variable_selector: [],
    dataset_ids: [],
    retrieval_mode: RETRIEVE_TYPE.multiWay,
    multiple_retrieval_config: {
      top_k: DATASET_DEFAULT.top_k,
      score_threshold: undefined,
      reranking_enable: false,
    },
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: KnowledgeRetrievalNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && (!payload.query_variable_selector || payload.query_variable_selector.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.knowledgeRetrieval.queryVariable`) })

    if (!errorMessages && (!payload.dataset_ids || payload.dataset_ids.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.knowledgeRetrieval.knowledge`) })

    if (!errorMessages && payload.retrieval_mode === RETRIEVE_TYPE.oneWay && !payload.single_retrieval_config?.model?.provider)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t('common.modelProvider.systemReasoningModel.key') })

    const { _datasets, multiple_retrieval_config, retrieval_mode } = payload
    if (retrieval_mode === RETRIEVE_TYPE.multiWay) {
      const checked = checkoutRerankModelConfigedInRetrievalSettings(_datasets || [], multiple_retrieval_config)

      if (!errorMessages && !checked)
        errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.errorMsg.fields.rerankModel`) })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
