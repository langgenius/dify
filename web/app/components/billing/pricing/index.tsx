'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import Header from './header'
import PlanSwitcher from './plan-switcher'
import { PlanRange } from './plan-switcher/plan-range-switcher'
import { useKeyPress } from 'ahooks'
import { useProviderContext } from '@/context/provider-context'
import { useAppContext } from '@/context/app-context'
import Plans from './plans'
// import { useTranslation } from 'react-i18next'
// import { RiArrowRightUpLine, RiCloseLine, RiCloudFill, RiTerminalBoxFill } from '@remixicon/react'
// import Link from 'next/link'
// import { Plan, SelfHostedPlan } from '../type'
// import TabSlider from '../../base/tab-slider'
// import PlanItem from './plan-item'
// import SelfHostedPlanItem from './self-hosted-plan-item'
// import GridMask from '@/app/components/base/grid-mask'
// import classNames from '@/utils/classnames'
// import { useGetPricingPageLanguage } from '@/context/i18n'

export type Category = 'cloud' | 'self'

type PricingProps = {
  onCancel: () => void
}

const Pricing: FC<PricingProps> = ({
  onCancel,
}) => {
  // const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { isCurrentWorkspaceManager } = useAppContext()
  const canPay = isCurrentWorkspaceManager
  const [planRange, setPlanRange] = React.useState<PlanRange>(PlanRange.monthly)

  const [currentCategory, setCurrentCategory] = useState<Category>('cloud')

  useKeyPress(['esc'], onCancel)

  // const pricingPageLanguage = useGetPricingPageLanguage()
  // const pricingPageURL = pricingPageLanguage
  //   ? `https://dify.ai/${pricingPageLanguage}/pricing#plans-and-features`
  //   : 'https://dify.ai/pricing#plans-and-features'

  return createPortal(
    <div
      className='fixed inset-0 bottom-0 left-0 right-0 top-0 z-[1000] overflow-auto bg-saas-background'
      onClick={e => e.stopPropagation()}
    >
      <div className='relative h-full min-w-[1200px]'>
        <Header onClose={onCancel} />
        <PlanSwitcher
          currentCategory={currentCategory}
          onChangeCategory={setCurrentCategory}
          currentPlanRange={planRange}
          onChangePlanRange={setPlanRange}
        />
        <Plans
          plan={plan}
          currentPlan={currentCategory}
          planRange={planRange}
          canPay={canPay}
        />
        {/* <GridMask wrapperClassName='w-full min-h-full' canvasClassName='min-h-full'>
          <div className='flex items-center justify-center py-4'>
            <div className='flex items-center justify-center gap-x-0.5 rounded-lg px-3 py-2 text-components-button-secondary-accent-text hover:cursor-pointer hover:bg-state-accent-hover'>
              <Link href={pricingPageURL} className='system-sm-medium'>{t('billing.plansCommon.comparePlanAndFeatures')}</Link>
              <RiArrowRightUpLine className='size-4' />
            </div>
          </div>
        </GridMask> */}
      </div>
    </div >,
    document.body,
  )
}
export default React.memo(Pricing)
