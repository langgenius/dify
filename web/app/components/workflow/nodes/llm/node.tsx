import type { FC } from 'react'
import { mockData } from './mock'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

const Node: FC = () => {
  const { provider, name: modelId } = mockData.model
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
