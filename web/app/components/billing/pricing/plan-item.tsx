'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Plan } from '../type'
import { ALL_PLANS } from '@/config'

type Props = {
  currentPlan: Plan
  plan: Plan
}

const KeyValue = ({ key, value }: { key: string; value: string }) => {
  return (
    <div className='mt-3.5 leading-[125%] text-[13px] font-medium text-gray-500'>
      <div className='text-gray-500'>{key}</div>
      <div className='mt-0.5 text-gray-900'>{value}</div>
    </div>
  )
}

const PlanItem: FC<Props> = ({
  plan,
}) => {
  const { t } = useTranslation()
  const i18nPrefix = `billing.plans.${plan}`
  const planInfo = ALL_PLANS[plan]

  return (
    <div>
      <div>
        <div>{t(`${i18nPrefix}.name`)}</div>
        <div>{t(`${i18nPrefix}.description`)}</div>

        {/* {}
        <div></div> */}
      </div>
    </div>
  )
}
export default React.memo(PlanItem)
