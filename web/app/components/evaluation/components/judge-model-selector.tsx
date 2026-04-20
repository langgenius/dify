'use client'

import type { EvaluationResourceProps } from '../types'
import { useEffect } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { useEvaluationResource, useEvaluationStore } from '../store'
import { decodeModelSelection, encodeModelSelection } from '../utils'

type JudgeModelSelectorProps = EvaluationResourceProps & {
  autoSelectFirst?: boolean
}

const JudgeModelSelector = ({
  resourceType,
  resourceId,
  autoSelectFirst = true,
}: JudgeModelSelectorProps) => {
  const { data: modelList } = useModelList(ModelTypeEnum.textGeneration)
  const resource = useEvaluationResource(resourceType, resourceId)
  const setJudgeModel = useEvaluationStore(state => state.setJudgeModel)
  const selectedModel = decodeModelSelection(resource.judgeModelId)

  useEffect(() => {
    if (!autoSelectFirst || resource.judgeModelId || !modelList.length)
      return

    const firstProvider = modelList[0]
    const firstModel = firstProvider.models[0]
    if (!firstProvider || !firstModel)
      return

    setJudgeModel(resourceType, resourceId, encodeModelSelection(firstProvider.provider, firstModel.model))
  }, [autoSelectFirst, modelList, resource.judgeModelId, resourceId, resourceType, setJudgeModel])

  return (
    <ModelSelector
      defaultModel={selectedModel}
      modelList={modelList}
      onSelect={model => setJudgeModel(resourceType, resourceId, encodeModelSelection(model.provider, model.model))}
      showDeprecatedWarnIcon
      triggerClassName="h-8 w-full rounded-lg"
    />
  )
}

export default JudgeModelSelector
