import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DocumentProcessingPriority,
  Plan,
} from '../type'
import { useProviderContext } from '@/context/provider-context'
import {
  ZapFast,
  ZapNarrow,
} from '@/app/components/base/icons/src/vender/solid/general'
import Tooltip from '@/app/components/base/tooltip'

const PriorityLabel = () => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()

  const priority = useMemo(() => {
    if (plan.type === Plan.sandbox)
      return DocumentProcessingPriority.standard

    if (plan.type === Plan.professional)
      return DocumentProcessingPriority.priority

    if (plan.type === Plan.team || plan.type === Plan.enterprise)
      return DocumentProcessingPriority.topPriority
  }, [plan])

  return (
    <Tooltip popupContent={
      <div>
        <div className='mb-1 text-xs font-semibold text-gray-700'>{`${t('billing.plansCommon.documentProcessingPriority')}: ${t(`billing.plansCommon.priority.${priority}`)}`}</div>
        {
          priority !== DocumentProcessingPriority.topPriority && (
            <div className='text-xs text-gray-500'>{t('billing.plansCommon.documentProcessingPriorityTip')}</div>
          )
        }
      </div>
    }>
      <span className={`
        flex items-center ml-1 px-[5px] h-[18px] rounded border border-[#C7D7FE]
        text-[10px] font-medium text-[#3538CD]
      `}>
        {
          plan.type === Plan.professional && (
            <ZapNarrow className='mr-0.5 w-3 h-3' />
          )
        }
        {
          (plan.type === Plan.team || plan.type === Plan.enterprise) && (
            <ZapFast className='mr-0.5 w-3 h-3' />
          )
        }
        {t(`billing.plansCommon.priority.${priority}`)}
      </span>
    </Tooltip>
  )
}

export default PriorityLabel
