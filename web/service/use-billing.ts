import { useMutation, useQuery } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { fetchCurrentPlanVectorSpace } from './billing'

const currentPlanVectorSpaceQueryKey = ['billing', 'current-plan-vector-space'] as const

export const useBindPartnerStackInfo = () => {
  return useMutation({
    mutationKey: consoleQuery.billing.bindPartnerStack.mutationKey(),
    mutationFn: (data: { partnerKey: string, clickId: string }) => consoleClient.billing.bindPartnerStack({
      params: { partnerKey: data.partnerKey },
      body: { click_id: data.clickId },
    }),
  })
}

export const useBillingUrl = (enabled: boolean) => {
  return useQuery({
    queryKey: consoleQuery.billing.invoices.queryKey(),
    enabled,
    queryFn: async () => {
      const res = await consoleClient.billing.invoices()
      return res.url
    },
  })
}

export const useCurrentPlanVectorSpace = (enabled = true) => {
  return useQuery({
    queryKey: currentPlanVectorSpaceQueryKey,
    queryFn: () => fetchCurrentPlanVectorSpace(),
    enabled,
  })
}
