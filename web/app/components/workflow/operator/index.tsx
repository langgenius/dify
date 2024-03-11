import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MiniMap } from 'reactflow'
import ZoomInOut from './zoom-in-out'
import { OrganizeGrid } from '@/app/components/base/icons/src/vender/line/layout'
import TooltipPlus from '@/app/components/base/tooltip-plus'

const Operator = () => {
  const { t } = useTranslation()

  return (
    <div className={`
      absolute left-6 bottom-6 z-10
    `}>
      <MiniMap
        style={{
          width: 128,
          height: 80,
        }}
        className='!static !m-0 !w-[128px] !h-[80px] !border-[0.5px] !border-black/[0.08] !rounded-lg !shadow-lg'
      />
      <div className='flex items-center mt-1 p-0.5 rounded-lg border-[0.5px] border-gray-100 bg-white shadow-lg text-gray-500'>
        <ZoomInOut />
        <TooltipPlus popupContent={t('workflow.panel.organizeBlocks')}>
          <div className='ml-[1px] flex items-center justify-center w-8 h-8 cursor-pointer hover:bg-black/5 rounded-lg'>
            <OrganizeGrid className='w-4 h-4' />
          </div>
        </TooltipPlus>
      </div>
    </div>
  )
}

export default memo(Operator)
