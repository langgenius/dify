import type { FC } from 'react'
import type { ParameterExtractorNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

const Node: FC<NodeProps<ParameterExtractorNodeType>> = ({
  data,
}) => {
  const { provider, name: modelId } = data.model || {}
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  const hasSetModel = provider && modelId
  return (
    <div className="mb-1 px-3 py-1">
      {hasSetModel && (
        <ModelSelector
          defaultModel={{ provider, model: modelId }}
          modelList={textGenerationModelList}
          triggerClassName="!h-6 !rounded-md"
          readonly
        />
      )}
    </div>
  )
}

export default React.memo(Node)
