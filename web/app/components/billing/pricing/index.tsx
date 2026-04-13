'use client'
import type { FC } from 'react'
import type { Category } from './types'
import * as React from 'react'
import { useState } from 'react'
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import {
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/app/components/base/ui/scroll-area'
import { useAppContext } from '@/context/app-context'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
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

const pricingScrollAreaClassNames = {
  root: 'relative h-full w-full overflow-hidden [--scroll-area-edge-hint-bg:var(--color-saas-background)]',
  viewport: 'overscroll-contain',
  content: 'min-h-full min-w-[1200px]',
  verticalScrollbar: 'data-[orientation=vertical]:my-2 data-[orientation=vertical]:me-1',
  horizontalScrollbar: 'data-[orientation=horizontal]:mx-2 data-[orientation=horizontal]:mb-0.5',
  corner: 'bg-saas-background',
} as const

const Pricing: FC<PricingProps> = ({
  onCancel,
}) => {
  const { plan } = useProviderContext()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [planRange, setPlanRange] = React.useState<PlanRange>(PlanRange.monthly)
  const [currentCategory, setCurrentCategory] = useState<Category>(CategoryEnum.CLOUD)
  const canPay = isCurrentWorkspaceManager

  const pricingPageLanguage = useGetPricingPageLanguage()
  const pricingPageURL = pricingPageLanguage
    ? `https://dify.ai/${pricingPageLanguage}/pricing#plans-and-features`
    : 'https://dify.ai/pricing#plans-and-features'

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent
        className="inset-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-none bg-saas-background p-0 shadow-none"
      >
        <ScrollAreaRoot className={pricingScrollAreaClassNames.root}>
          <ScrollAreaViewport className={pricingScrollAreaClassNames.viewport}>
            <ScrollAreaContent className={pricingScrollAreaClassNames.content}>
              <div className="relative grid min-h-full grid-rows-[1fr_auto_auto_1fr] overflow-hidden">
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
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar className={pricingScrollAreaClassNames.verticalScrollbar}>
            <ScrollAreaThumb className="rounded-full" />
          </ScrollAreaScrollbar>
          <ScrollAreaScrollbar
            orientation="horizontal"
            className={pricingScrollAreaClassNames.horizontalScrollbar}
          >
            <ScrollAreaThumb className="rounded-full" />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner className={pricingScrollAreaClassNames.corner} />
        </ScrollAreaRoot>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(Pricing)
