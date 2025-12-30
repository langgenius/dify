import type { SelfHostedPlan } from '@/app/components/billing/type'
import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Item from './item'

type ListProps = {
  plan: SelfHostedPlan
}

const List = ({
  plan,
}: ListProps) => {
  const { t } = useTranslation()
  const i18nPrefix = `plans.${plan}` as const
  const features = t(`${i18nPrefix}.features`, { ns: 'billing', returnObjects: true }) as string[]

  return (
    <div className="flex flex-col gap-y-[10px] p-6">
      <div className="system-md-semibold text-text-secondary">
        <Trans
          i18nKey={`${i18nPrefix}.includesTitle`}
          ns="billing"
          components={{ highlight: <span className="text-text-warning"></span> }}
        />
      </div>
      {features.map(feature => (
        <Item
          key={`${plan}-${feature}`}
          label={feature}
        />
      ),
      )}
    </div>
  )
}

export default React.memo(List)
