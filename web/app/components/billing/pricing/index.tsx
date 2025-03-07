'use client'
import type { FC } from 'react'
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine, RiCloseLine, RiCloudFill, RiTerminalBoxFill } from '@remixicon/react'
import Link from 'next/link'
import { useKeyPress } from 'ahooks'
import { Plan, SelfHostedPlan } from '../type'
import TabSlider from '../../base/tab-slider'
import SelectPlanRange, { PlanRange } from './select-plan-range'
import PlanItem from './plan-item'
import SelfHostedPlanItem from './self-hosted-plan-item'
import { useProviderContext } from '@/context/provider-context'
import GridMask from '@/app/components/base/grid-mask'
import { useAppContext } from '@/context/app-context'
import classNames from '@/utils/classnames'

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

  const [currentPlan, setCurrentPlan] = React.useState<string>('cloud')

  useKeyPress(['esc'], onCancel)

  return createPortal(
    <div
      className='fixed inset-0 top-0 right-0 bottom-0 left-0 p-4 bg-background-overlay-backdrop backdrop-blur-[6px] z-[1000]'
      onClick={e => e.stopPropagation()}
    >
      <div className='w-full h-full relative overflow-auto rounded-2xl border border-effects-highlight bg-saas-background'>
        <div
          className='fixed top-7 right-7 flex items-center justify-center w-9 h-9 bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover rounded-[10px] cursor-pointer z-[1001]'
          onClick={onCancel}
        >
          <RiCloseLine className='size-5 text-components-button-tertiary-text' />
        </div>
        <GridMask wrapperClassName='w-full min-h-full' canvasClassName='min-h-full'>
          <div className='pt-12 px-8 pb-7 flex flex-col items-center'>
            <div className='mb-2 title-5xl-bold text-text-primary'>
              {t('billing.plansCommon.title')}
            </div>
            <div className='system-sm-regular text-text-secondary'>
              <span>{t('billing.plansCommon.freeTrialTipPrefix')}</span>
              <span className='text-gradient font-semibold'>{t('billing.plansCommon.freeTrialTip')}</span>
              <span>{t('billing.plansCommon.freeTrialTipSuffix')}</span>
            </div>
          </div>
          <div className='w-[1152px] mx-auto'>
            <div className='py-2 flex items-center justify-between h-[64px]'>
              <TabSlider
                value={currentPlan}
                className='inline-flex'
                options={[
                  {
                    value: 'cloud',
                    text: <div className={
                      classNames('inline-flex items-center system-md-semibold-uppercase text-text-secondary',
                        currentPlan === 'cloud' && 'text-text-accent-light-mode-only')} >
                      <RiCloudFill className='size-4 mr-2' />{t('billing.plansCommon.cloud')}</div>,
                  },
                  {
                    value: 'self',
                    text: <div className={
                      classNames('inline-flex items-center system-md-semibold-uppercase text-text-secondary',
                        currentPlan === 'self' && 'text-text-accent-light-mode-only')}>
                      <RiTerminalBoxFill className='size-4 mr-2' />{t('billing.plansCommon.self')}</div>,
                  }]}
                onChange={v => setCurrentPlan(v)} />

              {currentPlan === 'cloud' && <SelectPlanRange
                value={planRange}
                onChange={setPlanRange}
              />}
            </div>
            <div className='pt-3 pb-8'>
              <div className='flex justify-center flex-nowrap gap-x-4'>
                {currentPlan === 'cloud' && <>
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
                </>}
                {currentPlan === 'self' && <>
                  <SelfHostedPlanItem
                    plan={SelfHostedPlan.community}
                    planRange={planRange}
                    canPay={canPay}
                  />
                  <SelfHostedPlanItem
                    plan={SelfHostedPlan.premium}
                    planRange={planRange}
                    canPay={canPay}
                  />
                  <SelfHostedPlanItem
                    plan={SelfHostedPlan.enterprise}
                    planRange={planRange}
                    canPay={canPay}
                  />
                </>}
              </div>
            </div>
          </div>
          <div className='py-4 flex items-center justify-center'>
            <div className='px-3 py-2 flex items-center justify-center gap-x-0.5 text-components-button-secondary-accent-text rounded-lg hover:bg-state-accent-hover hover:cursor-pointer'>
              <Link href='https://dify.ai/pricing#plans-and-features' className='system-sm-medium'>{t('billing.plansCommon.comparePlanAndFeatures')}</Link>
              <RiArrowRightUpLine className='size-4' />
            </div>
          </div>
        </GridMask>
      </div >
    </div >,
    document.body,
  )
}
export default React.memo(Pricing)
