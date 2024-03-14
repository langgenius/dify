import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { BlockEnum } from '../types'
import {
  NODES_EXTRA_DATA,
  NODES_INITIAL_DATA,
} from '../constants'
import { useStore } from '../store'
import type { LLMNodeType } from '../nodes/llm/types'
import type { QuestionClassifierNodeType } from '../nodes/question-classifier/types'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

export const useNodesInitialData = () => {
  const { t } = useTranslation()
  const nodesDefaultConfigs = useStore(s => s.nodesDefaultConfigs)
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(1)

  return useMemo(() => produce(NODES_INITIAL_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].title = t(`workflow.blocks.${key}`)

      if (currentProvider && currentModel && (key === BlockEnum.LLM || key === BlockEnum.QuestionClassifier)) {
        (draft[key as BlockEnum] as LLMNodeType | QuestionClassifierNodeType).model.provider = currentProvider.provider;
        (draft[key as BlockEnum] as LLMNodeType | QuestionClassifierNodeType).model.name = currentModel.model
      }

      if (nodesDefaultConfigs[key as BlockEnum]) {
        draft[key as BlockEnum] = {
          ...draft[key as BlockEnum],
          ...nodesDefaultConfigs[key as BlockEnum],
        }
      }
    })
  }), [t, nodesDefaultConfigs, currentProvider, currentModel])
}

export const useNodesExtraData = () => {
  const { t } = useTranslation()

  return produce(NODES_EXTRA_DATA, (draft) => {
    Object.keys(draft).forEach((key) => {
      draft[key as BlockEnum].about = t(`workflow.blocksAbout.${key}`)
    })
  })
}
