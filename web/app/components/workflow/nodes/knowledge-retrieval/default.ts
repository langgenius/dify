import { cloneDeep } from 'lodash-es'
import { v4 } from 'uuid'
import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { FilterItem, KnowledgeRetrievalNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

import { RETRIEVE_TYPE } from '@/types/app'
const i18nPrefix = 'workflow'

const defaultFilterItem: FilterItem = {
  uuid: v4(),
  key: '',
  field_condition: 'MatchValue',
  value_selector: [],
}

export function createDefaultFilterItem() {
  return {
    ...cloneDeep(defaultFilterItem),
    uuid: v4(),
  }
}

const nodeDefault: NodeDefault<KnowledgeRetrievalNodeType> = {
  defaultValue: {
    query_variable_selector: [],
    authorized_dataset_ids_variable_selector: [],
    filter_mode_to_metadata_filter_config_dict: {
      must: {
        filter_items: [],
      },
      should: {
        filter_items: [],
      },
      must_not: {
        filter_items: [],
      },
    },
    dataset_ids: [],
    retrieval_mode: RETRIEVE_TYPE.oneWay,
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

    if (!errorMessages && payload.retrieval_mode === RETRIEVE_TYPE.multiWay && !payload.multiple_retrieval_config?.reranking_model?.provider)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.errorMsg.fields.rerankModel`) })

    if (!errorMessages && payload.retrieval_mode === RETRIEVE_TYPE.oneWay && !payload.single_retrieval_config?.model?.provider)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t('common.modelProvider.systemReasoningModel.key') })

    if (!errorMessages && payload.filter_mode_to_metadata_filter_config_dict) {
      const filterItems = [
        ...(payload.filter_mode_to_metadata_filter_config_dict.must?.filter_items ?? []),
        ...(payload.filter_mode_to_metadata_filter_config_dict.should?.filter_items ?? []),
        ...(payload.filter_mode_to_metadata_filter_config_dict.must_not?.filter_items ?? []),
      ]

      for (let index = 0; index < filterItems.length; index++) {
        const filterItem = filterItems[index]

        if (!filterItem.key) {
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.knowledgeRetrieval.metadataFilterItem.parameter`) })
          break
        }

        if (!filterItem.field_condition) {
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.knowledgeRetrieval.metadataFilterItem.condition`) })
          break
        }

        if (!filterItem.value_selector?.length) {
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.knowledgeRetrieval.metadataFilterItem.valueSelector`) })
          break
        }
      }
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
