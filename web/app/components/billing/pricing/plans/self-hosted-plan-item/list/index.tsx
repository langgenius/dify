import type { SelfHostedPlan } from '@/app/components/billing/config'
import { Trans, useTranslation } from 'react-i18next'
import { SelfHostedPlanFeature } from './item'

export function SelfHostedPlanFeatures({ plan }: { plan: SelfHostedPlan }) {
  const { t } = useTranslation()
  const i18nPrefix = `plans.${plan}` as const
  const features = t(($) => $[`${i18nPrefix}.features`], {
    ns: 'billing',
    returnObjects: true,
  }) as string[]

  return (
    <div className="flex flex-col gap-y-2.5 p-6">
      <div className="system-md-semibold text-text-secondary">
        <Trans
          i18nKey={($) => $[`${i18nPrefix}.includesTitle`]}
          ns="billing"
          components={{ highlight: <span className="text-text-warning"></span> }}
        />
      </div>
      {features.map((feature) => (
        <SelfHostedPlanFeature key={`${plan}-${feature}`} label={feature} />
      ))}
    </div>
  )
}
