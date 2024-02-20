import type { FC } from 'react'
import InfoPanel from '../_base/components/info-panel'
import { mockData } from './mock'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

const Node: FC = () => {
  const { provider, name: modelId } = mockData.model
  const topics = mockData.topics
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
      <div className='mt-2 space-y-0.5'>
        {topics.map(topic => (
          <InfoPanel
            key={topic.id}
            title={topic.name}
            content={topic.topic}
          />
        ))}
      </div>
    </div>
  )
}

export default Node
