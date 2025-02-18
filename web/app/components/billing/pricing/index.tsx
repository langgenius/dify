'use client'
import type { FC } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import { Plan } from '../type'
import SelectPlanRange, { PlanRange } from './select-plan-range'
import PlanItem from './plan-item'
import { useProviderContext } from '@/context/provider-context'
import GridMask from '@/app/components/base/grid-mask'
import { useAppContext } from '@/context/app-context'

type Props = {
  onCancel: () => void
}

const Pricing: FC<Props> = ({
  onCancel,
}) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { isCurrentWorkspaceManager } = useAppContext()
  const canPay = isCurrentWorkspaceManager
  const [planRange, setPlanRange] = React.useState<PlanRange>(PlanRange.monthly)

  return createPortal(
    <div
      className='fixed inset-0 z-[1000] flex overflow-auto bg-white'
      onClick={e => e.stopPropagation()}
    >
      <GridMask wrapperClassName='grow'>
        <div className='width-[0] mt-6 flex grow flex-col items-center p-6'>
          <div className='mb-3 text-[30px] font-semibold leading-[38px] text-gray-900'>
            {t('billing.plansCommon.title')}
          </div>
          <SelectPlanRange
            value={planRange}
            onChange={setPlanRange}
          />
          <div className='mt-8 flex w-full flex-nowrap justify-center space-x-3 pb-6'>
            <PlanItem
              currentPlan={plan.type}
              plan={Plan.sandbox}
              planRange={planRange}
              canPay={canPay}
            />
            <PlanItem
              currentPlan={plan.type}
              plan={Plan.professional}
              planRange={planRange}
              canPay={canPay}
            />
            <PlanItem
              currentPlan={plan.type}
              plan={Plan.team}
              planRange={planRange}
              canPay={canPay}
            />
            <PlanItem
              currentPlan={plan.type}
              plan={Plan.enterprise}
              planRange={planRange}
              canPay={canPay}
            />
          </div>
        </div>
      </GridMask>

      <div
        className='fixed right-6 top-6 z-[1001] flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/[0.05] backdrop-blur-[2px]'
        onClick={onCancel}
      >
        <RiCloseLine className='h-4 w-4 text-gray-900' />
      </div>
    </div>,
    document.body,
  )
}
export default React.memo(Pricing)
