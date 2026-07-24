import { useTranslation } from 'react-i18next'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import Tooltip from '@/app/components/base/tooltip'

const PriorityUseTip = () => {
  const { t } = useTranslation()

  return (
    <Tooltip
      popupContent={t('modelProvider.priorityUsing', { ns: 'common' }) || ''}
    >
      <div className="absolute -right-[5px] -top-[5px] cursor-pointer rounded-[5px] border-[0.5px] border-components-panel-border-subtle bg-util-colors-indigo-indigo-50 shadow-xs">
        <ChevronDownDouble className="h-3 w-3 rotate-180 text-util-colors-indigo-indigo-600" />
      </div>
    </Tooltip>
  )
}

export default PriorityUseTip
