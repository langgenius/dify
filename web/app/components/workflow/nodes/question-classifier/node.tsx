import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import InfoPanel from '../_base/components/info-panel'
import { NodeSourceHandle } from '../_base/components/node-handle'
import type { QuestionClassifierNodeType } from './types'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

const Node: FC<NodeProps<QuestionClassifierNodeType>> = (props) => {
  const { t } = useTranslation()

  const { data } = props
  const { provider, name: modelId } = data.model
  // const tempTopics = data.topics
  const topics = data.classes
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()
  const hasSetModel = provider && modelId

  if (!hasSetModel && !topics.length)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      {hasSetModel && (
        <ModelSelector
          defaultModel={{ provider, model: modelId }}
          modelList={textGenerationModelList}
          readonly
        />
      )}
      {
        !!topics.length && (
          <div className='mt-2 space-y-0.5'>
            {topics.map((topic, index) => (
              <div
                key={index}
                className='relative'
              >
                <InfoPanel
                  title={`${t(`${i18nPrefix}.class`)} ${index + 1}`}
                  content={topic.name}
                />
                <NodeSourceHandle
                  {...props}
                  handleId={topic.id}
                  handleClassName='!top-1/2 !-translate-y-1/2 !-right-[21px]'
                />
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}

export default React.memo(Node)
