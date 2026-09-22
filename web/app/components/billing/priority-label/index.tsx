import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { RiAedFill } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'

type PriorityLabelProps = {
  className?: string
}

const PriorityLabel = ({ className }: PriorityLabelProps) => {
  const { t } = useTranslation()
  const titleId = useId()
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
    <div className={cn('ml-1 inline-flex shrink-0 items-center gap-1', className)}>
      <span className="inline-flex h-4.5 items-center rounded-[5px] border border-text-accent-secondary bg-components-badge-bg-dimm px-1.25 system-2xs-medium text-text-accent-secondary">
        {(plan === 'professional' || plan === 'team') && (
          <RiAedFill aria-hidden className="mr-0.5 size-3" />
        )}
        {t(($) => $[`plansCommon.priority.${label}`], { ns: 'billing' })}
      </span>
      <Infotip>
        <InfotipTrigger
          aria-label={t(($) => $['plansCommon.documentProcessingPriority'], { ns: 'billing' })}
        />
        <InfotipContent aria-labelledby={titleId}>
          <div id={titleId} className="font-semibold text-text-primary">
            {t(($) => $['plansCommon.documentProcessingPriority'], { ns: 'billing' })}:{' '}
            {t(($) => $[`plansCommon.priority.${label}`], { ns: 'billing' })}
          </div>
          {label !== 'top-priority' && (
            <div className="mt-1">
              {t(($) => $['plansCommon.documentProcessingPriorityTip'], { ns: 'billing' })}
            </div>
          )}
        </InfotipContent>
      </Infotip>
    </div>
  )
}

export default PriorityLabel
