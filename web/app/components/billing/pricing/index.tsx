'use client'

import { Dialog, DialogPortal } from '@langgenius/dify-ui/dialog'
import { useQueryState } from 'nuqs'
import { lazy, Suspense } from 'react'
import { pricingQueryParamName, pricingQueryParser } from './query-params'

const PricingDialogContent = lazy(() =>
  import('./dialog-content').then((module) => ({ default: module.PricingDialogContent })),
)

export function Pricing() {
  const [pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  return (
    <Suspense fallback={null}>
      <Dialog
        open={pricing === 'open'}
        onOpenChange={(open) => {
          setPricing(open ? 'open' : null)
        }}
      >
        <DialogPortal>
          <PricingDialogContent />
        </DialogPortal>
      </Dialog>
    </Suspense>
  )
}
