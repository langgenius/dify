'use client'

import { useEffect } from 'react'
import InvoiceRequestPage from '@/app/billing/invoice-request-page'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import { useProviderContext } from '@/context/provider-context'
import { useRouter } from '@/next/navigation'

export default function BillingInvoiceRequest() {
  const router = useRouter()
  const { enableBilling, isFetchedPlanInfo } = useProviderContext()

  useEffect(() => {
    if (!isFetchedPlanInfo)
      return

    if (!enableBilling)
      router.replace('/')
  }, [enableBilling, isFetchedPlanInfo, router])

  if (!isFetchedPlanInfo || !enableBilling)
    return <FullScreenLoading />

  return <InvoiceRequestPage />
}
