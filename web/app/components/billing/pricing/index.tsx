'use client'
import type { FC } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plan } from '../type'
import SelectPlanRange, { PlanRange } from './select-plan-range'
import PlanItem from './plan-item'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
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
      className='fixed inset-0 flex bg-white z-[1000] overflow-auto'
      onClick={e => e.stopPropagation()}
    >
      <GridMask wrapperClassName='grow'>
        <div className='grow width-[0] mt-6 p-6 flex flex-col items-center'>
          <div className='mb-3 leading-[38px] text-[30px] font-semibold text-gray-900'>
            {t('billing.plansCommon.title')}
          </div>
          <SelectPlanRange
            value={planRange}
            onChange={setPlanRange}
          />
          <div className='mt-8 pb-6 w-full justify-center flex-nowrap flex space-x-3'>
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
        className='fixed top-6 right-6 flex items-center justify-center w-10 h-10 bg-black/[0.05] rounded-full backdrop-blur-[2px] cursor-pointer z-[1001]'
        onClick={onCancel}
      >
        <XClose className='w-4 h-4 text-gray-900' />
      </div>
    </div>,
    document.body,
  )
}
export default React.memo(Pricing)
