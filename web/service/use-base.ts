import type { QueryKey } from '@tanstack/react-query'
import {
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback } from 'react'

/**
 * @deprecated Convenience wrapper scheduled for removal.
 * Prefer `useQueryClient()` + `useCallback(() => queryClient.invalidateQueries(...), [...])` directly.
 */
export const useInvalid = (key?: QueryKey) => {
  const queryClient = useQueryClient()
  return useCallback(() => {
    if (!key)
      return
    queryClient.invalidateQueries({ queryKey: key })
  }, [queryClient, key])
}

/**
 * @deprecated Convenience wrapper scheduled for removal.
 * Prefer `useQueryClient()` + `useCallback(() => queryClient.resetQueries(...), [...])` directly.
 */
export const useReset = (key?: QueryKey) => {
  const queryClient = useQueryClient()
  return useCallback(() => {
    if (!key)
      return
    queryClient.resetQueries({ queryKey: key })
  }, [queryClient, key])
}
