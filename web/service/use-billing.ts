import { useMutation } from '@tanstack/react-query'
import { put } from './base'

const NAME_SPACE = 'billing'

export const useBindPartnerStackInfo = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'bind-partner-stack'],
    mutationFn: (data: { partnerKey: string; clickId: string }) => {
      return put(`/billing/partners/${data.partnerKey}/tenants`, {
        body: {
          click_id: data.clickId,
        },
      })
    },
  })
}
