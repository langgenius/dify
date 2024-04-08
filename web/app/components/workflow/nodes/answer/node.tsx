import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import InfoPanel from '../_base/components/info-panel'
import ReadonlyInputWithSelectVar from '../_base/components/readonly-input-with-select-var'
import type { AnswerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
const Node: FC<NodeProps<AnswerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mb-1 px-3 py-1'>
      <InfoPanel title={t('workflow.nodes.answer.answer')} content={
        <ReadonlyInputWithSelectVar
          value={data.answer}
          nodeId={id}
        />
      } />
    </div>
  )
}

export default React.memo(Node)
