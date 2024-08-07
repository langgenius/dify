import { useTranslation } from 'react-i18next'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import TooltipPlus from '@/app/components/base/tooltip-plus'

const PriorityUseTip = () => {
  const { t } = useTranslation()

  return (
    <TooltipPlus
      popupContent={t('common.modelProvider.priorityUsing') || ''}
      needsDelay={false}
    >
      <div className='absolute -right-[5px] -top-[5px] bg-indigo-50 rounded-[5px] border-[0.5px] border-indigo-100 cursor-pointer'>
        <ChevronDownDouble className='rotate-180 w-3 h-3 text-indigo-600' />
      </div>
    </TooltipPlus>
  )
}

export default PriorityUseTip
