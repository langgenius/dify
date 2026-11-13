'use client'

import { Dialog, DialogPortal } from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { lazy, Suspense } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { pricingQueryParamName, pricingQueryParser } from './query-params'

const PricingDialogContent = lazy(() =>
  import('./dialog-content').then((module) => ({ default: module.PricingDialogContent })),
)

export function Pricing() {
  const { data: deploymentEdition } = useQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const [pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  if (deploymentEdition !== 'CLOUD') return null

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
