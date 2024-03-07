import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ZoomInOut from './zoom-in-out'
import { OrganizeGrid } from '@/app/components/base/icons/src/vender/line/layout'
import TooltipPlus from '@/app/components/base/tooltip-plus'

const Operator = () => {
  const { t } = useTranslation()

  return (
    <div className={`
      absolute left-6 bottom-6 flex items-center p-0.5 
      rounded-lg border-[0.5px] border-gray-100 bg-white shadow-lg text-gray-500 z-10
    `}>
      <ZoomInOut />
      <TooltipPlus popupContent={t('workflow.panel.organizeBlocks')}>
        <div className='ml-[1px] flex items-center justify-center w-8 h-8 cursor-pointer hover:bg-black/5 rounded-lg'>
          <OrganizeGrid className='w-4 h-4' />
        </div>
      </TooltipPlus>
    </div>
  )
}

export default memo(Operator)
