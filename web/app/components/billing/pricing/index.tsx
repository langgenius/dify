'use client'
import type { FC } from 'react'
import type { Category } from './types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import {
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { BillingPermission, hasPermission } from '@/utils/permission'
import { NoiseBottom, NoiseTop } from './assets'
import Footer from './footer'
import Header from './header'
import PlanSwitcher from './plan-switcher'
import { PlanRange } from './plan-switcher/plan-range-switcher'
import Plans from './plans'
import { CategoryEnum } from './types'

type PricingProps = {
  onCancel: () => void
}

const Pricing: FC<PricingProps> = ({ onCancel }) => {
  const { plan, enableEducationPlan, isEducationAccount } = useProviderContext()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageBilling = hasPermission(workspacePermissionKeys, BillingPermission.Manage)
  const shouldDefaultToYearly = canManageBilling && enableEducationPlan && isEducationAccount
  const [selectedPlanRange, setSelectedPlanRange] = React.useState<PlanRange>()
  const planRange =
    selectedPlanRange ?? (shouldDefaultToYearly ? PlanRange.yearly : PlanRange.monthly)
  const [currentCategory, setCurrentCategory] = useState<Category>(CategoryEnum.CLOUD)
  const canPay = canManageBilling

  const pricingPageLanguage = useGetPricingPageLanguage()
  const pricingPageURL = pricingPageLanguage
    ? `https://dify.ai/${pricingPageLanguage}/pricing#plans-and-features`
    : 'https://dify.ai/pricing#plans-and-features'

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="inset-0 size-full max-h-none max-w-none translate-0 overflow-hidden rounded-none border-none bg-saas-background p-0 shadow-none">
        <ScrollAreaRoot className="relative h-full w-full overflow-hidden">
          <ScrollAreaViewport className="overscroll-contain">
            <ScrollAreaContent className="min-h-full min-w-300">
              <div className="relative grid min-h-full grid-rows-[1fr_auto_auto_1fr] overflow-hidden">
                <div className="absolute inset-x-0 -top-12 -z-10">
                  <NoiseTop />
                </div>
                <Header onClose={onCancel} />
                <PlanSwitcher
                  currentCategory={currentCategory}
                  onChangeCategory={setCurrentCategory}
                  currentPlanRange={planRange}
                  onChangePlanRange={setSelectedPlanRange}
                />
                <Plans
                  plan={plan}
                  currentPlan={currentCategory}
                  planRange={planRange}
                  canPay={canPay}
                />
                <Footer pricingPageURL={pricingPageURL} currentCategory={currentCategory} />
                <div className="absolute inset-x-0 -bottom-12 -z-10">
                  <NoiseBottom />
                </div>
              </div>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb className="rounded-full" />
          </ScrollAreaScrollbar>
          <ScrollAreaScrollbar orientation="horizontal">
            <ScrollAreaThumb className="rounded-full" />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner className="bg-saas-background" />
        </ScrollAreaRoot>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(Pricing)
