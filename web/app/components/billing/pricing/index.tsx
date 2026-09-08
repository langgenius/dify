'use client'

import { Dialog, DialogPortal } from '@langgenius/dify-ui/dialog'
import { useQueryState } from 'nuqs'
import dynamic from '@/next/dynamic'
import { pricingQueryParamName, pricingQueryParser } from './query-params'

const PricingDialogContent = dynamic(
  () => import('./dialog-content').then((module) => module.PricingDialogContent),
  { ssr: false },
)

export function Pricing() {
  const [pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  return (
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
  )
}
