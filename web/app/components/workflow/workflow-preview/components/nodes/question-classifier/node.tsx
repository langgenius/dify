import type { FC } from 'react'
import type { NodeProps } from 'reactflow'
import type { QuestionClassifierNodeType } from '@/app/components/workflow/nodes/question-classifier/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import InfoPanel from '@/app/components/workflow/nodes/_base/components/info-panel'
import { getDisplayClassLabel } from '@/app/components/workflow/nodes/question-classifier/components/class-label-utils'
import { NodeSourceHandle } from '../../node-handle'

const Node: FC<NodeProps<QuestionClassifierNodeType>> = (props) => {
  const { t } = useTranslation()
  const { data } = props
  const topics = data.classes

  return (
    <div className="mb-1 px-3 py-1">
      {
        !!topics.length && (
          <div className="mt-2 space-y-0.5">
            {topics.map((topic, index) => (
              <div
                key={topic.id}
                className="relative"
              >
                <InfoPanel
                  title={getDisplayClassLabel(topic.label, index + 1, t)}
                  content={topic.name}
                  titleClassName="text-xs font-semibold leading-4 normal-case"
                />
                <NodeSourceHandle
                  {...props}
                  handleId={topic.id}
                  handleClassName="!top-1/2 !-translate-y-1/2 !-right-[21px]"
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
