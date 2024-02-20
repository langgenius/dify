import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { mockData } from './mock'

const Node: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='px-3'>
      <div className='px-[5px] py-[3px] bg-gray-100 rounded-md'>
        <div className='leading-4 text-[10px] font-medium text-gray-500 uppercase'>
          {t('workflow.nodes.directAnswer.answer')}
        </div>
        <div className='leading-4 text-xs font-normal text-gray-700'>
          {mockData.answer}
        </div>
      </div>
    </div>
  )
}

export default Node
