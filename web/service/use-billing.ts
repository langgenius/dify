import { useMutation, useQuery } from '@tanstack/react-query'
import { bindPartnerStackInfo, fetchBillingUrl } from '@/service/billing'

const NAME_SPACE = 'billing'

export const useBindPartnerStackInfo = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'bind-partner-stack'],
    mutationFn: (data: { partnerKey: string; clickId: string }) => bindPartnerStackInfo(data.partnerKey, data.clickId),
  })
}

export const useBillingUrl = (enabled: boolean) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'url'],
    enabled,
    queryFn: async () => {
      const res = await fetchBillingUrl()
      return res.url
    },
  })
}
