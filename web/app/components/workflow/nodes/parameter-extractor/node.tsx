import type { FC } from 'react'
import React from 'react'
import type { ParameterExtractorNodeType } from './types'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<ParameterExtractorNodeType>> = ({
  data,
}) => {
  const { provider, name: modelId } = data.model || {}
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  const hasSetModel = provider && modelId
  return (
    <div className='mb-1 px-3 py-1'>
      {hasSetModel && (
        <ModelSelector
          defaultModel={{ provider, model: modelId }}
          modelList={textGenerationModelList}
          readonly
        />
      )}
    </div>
  )
}

export default React.memo(Node)
