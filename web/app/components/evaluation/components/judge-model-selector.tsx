'use client'

import type { EvaluationResourceProps } from '../types'
import { useEffect } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useEvaluationResource, useEvaluationStore } from '../store'
import { decodeModelSelection, encodeModelSelection } from '../utils'

const JudgeModelSelector = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { data: modelList } = useModelList(ModelTypeEnum.textGeneration)
  const resource = useEvaluationResource(resourceType, resourceId)
  const setJudgeModel = useEvaluationStore(state => state.setJudgeModel)
  const selectedModel = decodeModelSelection(resource.judgeModelId)

  useEffect(() => {
    if (resource.judgeModelId || !modelList.length)
      return

    const firstProvider = modelList[0]
    const firstModel = firstProvider.models[0]
    if (!firstProvider || !firstModel)
      return

    setJudgeModel(resourceType, resourceId, encodeModelSelection(firstProvider.provider, firstModel.model))
  }, [modelList, resource.judgeModelId, resourceId, resourceType, setJudgeModel])

  return (
    <ModelSelector
      defaultModel={selectedModel}
      modelList={modelList}
      onSelect={model => setJudgeModel(resourceType, resourceId, encodeModelSelection(model.provider, model.model))}
      showDeprecatedWarnIcon
      triggerClassName="h-11"
    />
  )
}

export default JudgeModelSelector
