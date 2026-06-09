import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiAedFill } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
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
    <Tooltip>
      <TooltipTrigger
        render={(
          <div
            className={cn(
              'ml-1 inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-[5px] system-2xs-medium text-text-accent-secondary',
              className,
            )}
          />
        )}
      >
        {
          (plan.type === Plan.professional || plan.type === Plan.team || plan.type === Plan.enterprise) && (
            <RiAedFill className="mr-0.5 size-3" />
          )
        }
        <span>{t(`plansCommon.priority.${priority}`, { ns: 'billing' })}</span>
      </TooltipTrigger>
      <TooltipContent>
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
      </TooltipContent>
    </Tooltip>
  )
}

export default PriorityLabel
