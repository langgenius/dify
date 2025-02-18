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
        border-text-accent-secondary text-2xs text-text-accent-secondary ml-1 flex h-[18px] shrink-0 items-center rounded-[5px]
        border px-1 font-medium
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
