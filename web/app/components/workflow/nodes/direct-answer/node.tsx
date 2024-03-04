import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import InfoPanel from '../_base/components/info-panel'
import type { DirectAnswerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<DirectAnswerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className='px-3'>
      <InfoPanel title={t('workflow.nodes.directAnswer.answer')} content={data.answer} />
    </div>
  )
}

export default Node
