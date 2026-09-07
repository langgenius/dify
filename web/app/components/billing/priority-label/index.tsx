import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiAedFill } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/client'

type PriorityLabelProps = {
  className?: string
}

const PriorityLabel = ({ className }: PriorityLabelProps) => {
  const { t } = useTranslation()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )

  if (deploymentEdition !== 'CLOUD' || plan === undefined) return null
  const priority = { sandbox: 'standard', professional: 'priority', team: 'top-priority' } as const
  const label = priority[plan]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              'ml-1 inline-flex h-4.5 shrink-0 items-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1.25 system-2xs-medium text-text-accent-secondary',
              className,
            )}
          />
        }
      >
        {(plan === 'professional' || plan === 'team') && <RiAedFill className="mr-0.5 size-3" />}
        <span>{t(($) => $[`plansCommon.priority.${label}`], { ns: 'billing' })}</span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="mb-1 text-xs font-semibold text-text-primary">
          {t(($) => $['plansCommon.documentProcessingPriority'], { ns: 'billing' })}:{' '}
          {t(($) => $[`plansCommon.priority.${label}`], { ns: 'billing' })}
        </div>
        {label !== 'top-priority' && (
          <div className="text-xs text-text-secondary">
            {t(($) => $['plansCommon.documentProcessingPriorityTip'], { ns: 'billing' })}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export default PriorityLabel
