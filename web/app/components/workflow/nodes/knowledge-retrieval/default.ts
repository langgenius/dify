import type { NodeDefault } from '../../types'
import type { KnowledgeRetrievalNodeType } from './types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { DATASET_DEFAULT } from '@/config'
import { RETRIEVE_TYPE } from '@/types/app'
import { checkoutRerankModelConfiguredInRetrievalSettings } from './utils'

const i18nPrefix = ''

const metaData = genNodeMetaData({
  sort: 2,
  type: BlockEnum.KnowledgeRetrieval,
})
const nodeDefault: NodeDefault<KnowledgeRetrievalNodeType> = {
  metaData,
  defaultValue: {
    query_variable_selector: [],
    query_attachment_selector: [],
    dataset_ids: [],
    retrieval_mode: RETRIEVE_TYPE.multiWay,
    multiple_retrieval_config: {
      top_k: DATASET_DEFAULT.top_k,
      score_threshold: undefined,
      reranking_enable: false,
    },
  },
  checkValid(payload: KnowledgeRetrievalNodeType, t: any) {
    let errorMessages = ''

    if (!errorMessages && (!payload.dataset_ids || payload.dataset_ids.length === 0))
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}nodes.knowledgeRetrieval.knowledge`, { ns: 'workflow' }) })

    if (!errorMessages && payload.retrieval_mode === RETRIEVE_TYPE.oneWay && !payload.single_retrieval_config?.model?.provider)
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t('modelProvider.systemReasoningModel.key', { ns: 'common' }) })

    const { _datasets, multiple_retrieval_config, retrieval_mode } = payload
    if (retrieval_mode === RETRIEVE_TYPE.multiWay) {
      const checked = checkoutRerankModelConfiguredInRetrievalSettings(_datasets || [], multiple_retrieval_config)

      if (!errorMessages && !checked)
        errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}errorMsg.fields.rerankModel`, { ns: 'workflow' }) })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
