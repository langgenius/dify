import type { FC } from 'react'
import React from 'react'
import type { VannaNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

import ModelSelector from "@/app/components/header/account-setting/model-provider-page/model-selector";
import {
  useTextGenerationCurrentProviderAndModelAndModelList
} from "@/app/components/header/account-setting/model-provider-page/hooks";

const Node: FC<NodeProps<VannaNodeType>> = ({
  data,
}) => {

  const { provider, name: modelId } = data.model || {}
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  const hasSetModel = provider && modelId

  return (
    <div className='mb-1 space-y-0.5 px-3 py-1'>
      {hasSetModel && (
          <ModelSelector
              defaultModel={{ provider, model: modelId }}
              modelList={textGenerationModelList}
              triggerClassName='!h-6 !rounded-md'
              readonly
          />
      )}
    </div>
  )
}

export default React.memo(Node)
