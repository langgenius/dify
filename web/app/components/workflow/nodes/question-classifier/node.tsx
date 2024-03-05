import type { FC } from 'react'
import React from 'react'
import type { NodeProps } from 'reactflow'
import InfoPanel from '../_base/components/info-panel'
import { NodeSourceHandle } from '../_base/components/node-handle'

import type { QuestionClassifierNodeType } from './types'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

const Node: FC<NodeProps<QuestionClassifierNodeType>> = (props) => {
  const { data } = props
  const { provider, name: modelId } = data.model
  // const tempTopics = data.topics
  const topics = data.classes
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
      </div>
    </div>
  )
}

export default React.memo(Node)
