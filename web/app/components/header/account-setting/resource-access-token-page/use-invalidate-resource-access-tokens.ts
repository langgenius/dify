'use client'

import { useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function useInvalidateResourceAccessTokens() {
  const queryClient = useQueryClient()

  return () =>
    queryClient.invalidateQueries({
      queryKey: consoleQuery.resourceAccessTokens.get.key(),
    })
}
