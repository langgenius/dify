import {
  type QueryKey,
  useQueryClient,
} from '@tanstack/react-query'

export const useInvalid = (key: QueryKey) => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: key,
      },
    )
  }
}

export const useReset = (key: QueryKey) => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.resetQueries(
      {
        queryKey: key,
      },
    )
  }
}
