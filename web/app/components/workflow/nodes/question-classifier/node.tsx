import type { TFunction } from 'i18next'
import type { FC } from 'react'
import type { NodeProps } from 'reactflow'
import type { QuestionClassifierNodeType } from './types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { NodeSourceHandle } from '../_base/components/node-handle'
import ReadonlyInputWithSelectVar from '../_base/components/readonly-input-with-select-var'

const i18nPrefix = 'nodes.questionClassifiers'

const MAX_CLASS_TEXT_LENGTH = 50

type TruncatedClassItemProps = {
  topic: { id: string, name: string }
  index: number
  nodeId: string
  t: TFunction
}

const TruncatedClassItem: FC<TruncatedClassItemProps> = ({ topic, index, nodeId, t }) => {
  const truncatedText = topic.name.length > MAX_CLASS_TEXT_LENGTH
    ? `${topic.name.slice(0, MAX_CLASS_TEXT_LENGTH)}...`
    : topic.name

  const shouldShowTooltip = topic.name.length > MAX_CLASS_TEXT_LENGTH

  const content = (
    <div className="system-xs-regular truncate text-text-tertiary">
      <ReadonlyInputWithSelectVar
        value={truncatedText}
        nodeId={nodeId}
        className="truncate"
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-y-0.5 rounded-md bg-workflow-block-parma-bg px-[5px] py-[3px]">
      <div className="system-2xs-semibold-uppercase uppercase text-text-secondary">
        {`${t(`${i18nPrefix}.class`, { ns: 'workflow' })} ${index + 1}`}
      </div>
      {shouldShowTooltip
        ? (
            <Tooltip
              popupContent={(
                <div className="max-w-[300px] break-words">
                  <ReadonlyInputWithSelectVar value={topic.name} nodeId={nodeId} />
                </div>
              )}
            >
              {content}
            </Tooltip>
          )
        : content}
    </div>
  )
}

const Node: FC<NodeProps<QuestionClassifierNodeType>> = (props) => {
  const { t } = useTranslation()

  const { data, id } = props
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
    <div className="mb-1 px-3 py-1">
      {hasSetModel && (
        <ModelSelector
          defaultModel={{ provider, model: modelId }}
          triggerClassName="!h-6 !rounded-md"
          modelList={textGenerationModelList}
          readonly
        />
      )}
      {
        !!topics.length && (
          <div className="mt-2 space-y-0.5">
            <div className="space-y-0.5">
              {topics.map((topic, index) => (
                <div
                  key={topic.id}
                  className="relative"
                >
                  <TruncatedClassItem
                    topic={topic}
                    index={index}
                    nodeId={id}
                    t={t}
                  />
                  <NodeSourceHandle
                    {...props}
                    handleId={topic.id}
                    handleClassName="!top-1/2 !-translate-y-1/2 !-right-[21px]"
                  />
                </div>
              ))}
            </div>
          </div>
        )
      }
    </div>
  )
}

export default React.memo(Node)
