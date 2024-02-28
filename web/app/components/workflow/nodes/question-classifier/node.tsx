import type { FC } from 'react'
import { useState } from 'react'
import type { NodeProps } from 'reactflow'
import InfoPanel from '../_base/components/info-panel'
import { NodeSourceHandle } from '../_base/components/node-handle'
import { mockData } from './mock'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

const Node: FC<Pick<NodeProps, 'id' | 'data'>> = (props) => {
  const { provider, name: modelId } = mockData.model
  const tempTopics = mockData.topics
  const [topics, setTopics] = useState(tempTopics)
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
          <div
            key={topic.id}
            className='relative'
          >
            <InfoPanel
              title={topic.name}
              content={topic.topic}
            />
            <NodeSourceHandle
              {...props}
              handleId={topic.name}
              handleClassName='!top-[11px] !-right-[21px]'
            />
          </div>
        ))}
        {/* For test */}
        <div
          className='mt-1 flex items-center h-6 justify-center bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'
          onClick={() => {
            setTopics([...topics, {
              id: `${Date.now()}`,
              name: `Topic${topics.length}`,
              topic: `Topic${topics.length}`,
            }])
          }}
        >Add</div>
      </div>
    </div>
  )
}

export default Node
