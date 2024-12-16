import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DocumentProcessingPriority,
  Plan,
} from '../type'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import {
  ZapFast,
  ZapNarrow,
} from '@/app/components/base/icons/src/vender/solid/general'
import Tooltip from '@/app/components/base/tooltip'

type PriorityLabelProps = {
  className?: string
}

const PriorityLabel = ({ className }: PriorityLabelProps) => {
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
      <span className={cn(`
        shrink-0 flex items-center ml-1 px-1 h-[18px] rounded-[5px] border border-text-accent-secondary
        text-2xs font-medium text-text-accent-secondary
      `, className)}>
        {
          plan.type === Plan.professional && (
            <ZapNarrow className='mr-0.5 size-3' />
          )
        }
        {
          (plan.type === Plan.team || plan.type === Plan.enterprise) && (
            <ZapFast className='mr-0.5 size-3' />
          )
        }
        {t(`billing.plansCommon.priority.${priority}`)}
      </span>
    </Tooltip>
  )
}

export default PriorityLabel
