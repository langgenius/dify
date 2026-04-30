'use client'

import type { EvaluationResourceProps } from '../types'
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
