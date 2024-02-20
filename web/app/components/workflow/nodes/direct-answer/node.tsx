import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import InfoPanel from '../_base/components/info-panel'
import { mockData } from './mock'

const Node: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='px-3'>
      <InfoPanel title={t('workflow.nodes.directAnswer.answer')} content={mockData.answer} />
    </div>
  )
}

export default Node
