import React from 'react'
import type { SelfHostedPlan } from '@/app/components/billing/type'
import { Trans, useTranslation } from 'react-i18next'
import Item from './item'

type ListProps = {
  plan: SelfHostedPlan
}

const List = ({
  plan,
}: ListProps) => {
  const { t } = useTranslation()
  const i18nPrefix = `billing.plans.${plan}`
  const features = t(`${i18nPrefix}.features`, { returnObjects: true }) as string[]

  return (
    <div className='flex flex-col gap-y-[10px] p-6'>
      <div className='system-md-semibold text-text-secondary'>
        <Trans
          i18nKey={t(`${i18nPrefix}.includesTitle`)}
          components={{ highlight: <span className='text-text-warning'></span> }}
        />
      </div>
      {features.map(feature =>
        <Item
          key={`${plan}-${feature}`}
          label={feature}
        />,
      )}
    </div>
  )
}

export default React.memo(List)
