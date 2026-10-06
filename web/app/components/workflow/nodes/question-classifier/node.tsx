import type { FC } from 'react'
import type { NodeProps } from 'reactflow'
import type { QuestionClassifierNodeType } from './types'
import * as React from 'react'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { NodeBranches } from '../_base/components/branch-list/node-branches'

const Node: FC<NodeProps<QuestionClassifierNodeType>> = (props) => {
  const { data } = props
  const { provider, name: modelId } = data.model
  // const tempTopics = data.topics
  const topics = data.classes
  const { textGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const hasSetModel = provider && modelId

  if (!hasSetModel && !topics.length) return null

  return (
    <div className="mb-1 px-3 py-1">
      {hasSetModel && (
        <ModelSelector
          value={{ provider, model: modelId }}
          models={textGenerationModelList}
          size="small"
          disabled
        />
      )}
      {!!topics.length && <NodeBranches node={props} branches={topics} />}
    </div>
  )
}

export default React.memo(Node)
