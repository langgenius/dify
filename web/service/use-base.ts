import type { QueryKey } from '@tanstack/react-query'
import {

  useQueryClient,
} from '@tanstack/react-query'

export const useInvalid = (key?: QueryKey) => {
  const queryClient = useQueryClient()
  return () => {
    if (!key)
      return
    queryClient.invalidateQueries(
      {
        queryKey: key,
      },
    )
  }
}

export const useReset = (key?: QueryKey) => {
  const queryClient = useQueryClient()
  return () => {
    if (!key)
      return
    queryClient.resetQueries(
      {
        queryKey: key,
      },
    )
  }
}
