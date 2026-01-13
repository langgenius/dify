import { useMutation, useQuery } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

export const useBindPartnerStackInfo = () => {
  return useMutation({
    mutationKey: consoleQuery.bindPartnerStack.mutationKey(),
    mutationFn: (data: { partnerKey: string, clickId: string }) => consoleClient.bindPartnerStack({
      params: { partnerKey: data.partnerKey },
      body: { click_id: data.clickId },
    }),
  })
}

export const useBillingUrl = (enabled: boolean) => {
  return useQuery({
    queryKey: consoleQuery.billingUrl.queryKey(),
    enabled,
    queryFn: async () => {
      const res = await consoleClient.billingUrl()
      return res.url
    },
  })
}
