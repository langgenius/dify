'use client'
import type { FC } from 'react'
import { useKeyPress } from 'ahooks'
import * as React from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppContext } from '@/context/app-context'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { NoiseBottom, NoiseTop } from './assets'
import Footer from './footer'
import Header from './header'
import PlanSwitcher from './plan-switcher'
import { PlanRange } from './plan-switcher/plan-range-switcher'
import Plans from './plans'

export enum CategoryEnum {
  CLOUD = 'cloud',
  SELF = 'self',
}

export type Category = CategoryEnum.CLOUD | CategoryEnum.SELF

type PricingProps = {
  onCancel: () => void
}

const Pricing: FC<PricingProps> = ({
  onCancel,
}) => {
  const { plan } = useProviderContext()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [planRange, setPlanRange] = React.useState<PlanRange>(PlanRange.monthly)
  const [currentCategory, setCurrentCategory] = useState<Category>(CategoryEnum.CLOUD)
  const canPay = isCurrentWorkspaceManager
  useKeyPress(['esc'], onCancel)

  const pricingPageLanguage = useGetPricingPageLanguage()
  const pricingPageURL = pricingPageLanguage
    ? `https://dify.ai/${pricingPageLanguage}/pricing#plans-and-features`
    : 'https://dify.ai/pricing#plans-and-features'

  return createPortal(
    <div
      className="fixed inset-0 bottom-0 left-0 right-0 top-0 z-[1000] overflow-auto bg-saas-background"
      onClick={e => e.stopPropagation()}
    >
      <div className="relative grid min-h-full min-w-[1200px] grid-rows-[1fr_auto_auto_1fr] overflow-hidden">
        <div className="absolute -top-12 left-0 right-0 -z-10">
          <NoiseTop />
        </div>
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
        <Footer pricingPageURL={pricingPageURL} currentCategory={currentCategory} />
        <div className="absolute -bottom-12 left-0 right-0 -z-10">
          <NoiseBottom />
        </div>
      </div>
    </div>,
    document.body,
  )
}
export default React.memo(Pricing)
