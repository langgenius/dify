import type { FC } from 'react'
import type { LLMNodeType } from './types'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<LLMNodeType>> = ({
  data,
}) => {
  const { provider, name: modelId } = data.model
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  return (
    <div className='px-3'>
      <ModelSelector
        defaultModel={(provider || modelId) ? { provider, model: modelId } : undefined}
        modelList={textGenerationModelList}
        readonly
      />
    </div>
  )
}

export default Node
