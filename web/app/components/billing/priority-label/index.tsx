import { RiAedFill } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import {
  DocumentProcessingPriority,
  Plan,
} from '../type'

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

    return DocumentProcessingPriority.standard
  }, [plan])

  return (
    <Tooltip popupContent={(
      <div>
        <div className="mb-1 text-xs font-semibold text-text-primary">
          {t('plansCommon.documentProcessingPriority', { ns: 'billing' })}
          :
          {' '}
          {t(`plansCommon.priority.${priority}`, { ns: 'billing' })}
        </div>
        {
          priority !== DocumentProcessingPriority.topPriority && (
            <div className="text-xs text-text-secondary">{t('plansCommon.documentProcessingPriorityTip', { ns: 'billing' })}</div>
          )
        }
      </div>
    )}
    >
      <div
        className={cn(
          'system-2xs-medium ml-1 inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-[5px] text-text-accent-secondary',
          className,
        )}
      >
        {
          (plan.type === Plan.professional || plan.type === Plan.team || plan.type === Plan.enterprise) && (
            <RiAedFill className="mr-0.5 size-3" />
          )
        }
        <span>{t(`plansCommon.priority.${priority}`, { ns: 'billing' })}</span>
      </div>
    </Tooltip>
  )
}

export default PriorityLabel
