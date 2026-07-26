import { useMutation, useQuery } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

export const useBindPartnerStackInfo = () => {
  return useMutation({
    mutationKey: consoleQuery.billing.partners.byPartnerKey.tenants.put.mutationKey(),
    mutationFn: (data: { partnerKey: string; clickId: string }) =>
      consoleClient.billing.partners.byPartnerKey.tenants.put({
        params: { partner_key: data.partnerKey },
        body: { click_id: data.clickId },
      }),
  })
}

export const useBillingUrl = (enabled: boolean) => {
  return useQuery({
    queryKey: consoleQuery.billing.invoices.get.queryKey(),
    enabled,
    queryFn: async () => {
      const res = await consoleClient.billing.invoices.get()
      return res.url
    },
  })
}
