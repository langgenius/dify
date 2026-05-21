'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchCurrentPlanVectorSpace } from '@/service/billing'

export const currentPlanVectorSpaceQueryKey = ['billing', 'current-plan-vector-space'] as const

export const useCurrentPlanVectorSpace = (enabled = true) => {
  return useQuery({
    queryKey: currentPlanVectorSpaceQueryKey,
    queryFn: fetchCurrentPlanVectorSpace,
    enabled,
  })
}
