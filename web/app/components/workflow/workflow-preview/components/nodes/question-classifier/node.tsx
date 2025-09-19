import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import InfoPanel from '@/app/components/workflow/nodes/_base/components/info-panel'
import type { QuestionClassifierNodeType } from '@/app/components/workflow/nodes/question-classifier/types'
import { NodeSourceHandle } from '../../node-handle'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

const Node: FC<NodeProps<QuestionClassifierNodeType>> = (props) => {
  const { t } = useTranslation()
  const { data } = props
  const topics = data.classes

  return (
    <div className='mb-1 px-3 py-1'>
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
                  content={''}
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
