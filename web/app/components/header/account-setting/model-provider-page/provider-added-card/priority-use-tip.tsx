import { useTranslation } from 'react-i18next'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import Tooltip from '@/app/components/base/tooltip'

const PriorityUseTip = () => {
  const { t } = useTranslation()

  return (
    <Tooltip
      popupContent={t('common.modelProvider.priorityUsing') || ''}
    >
      <div className='absolute -right-[5px] -top-[5px] bg-util-colors-indigo-indigo-50 rounded-[5px] border-[0.5px] border-components-panel-border-subtle shadow-xs cursor-pointer'>
        <ChevronDownDouble className='rotate-180 w-3 h-3 text-util-colors-indigo-indigo-600' />
      </div>
    </Tooltip>
  )
}

export default PriorityUseTip
