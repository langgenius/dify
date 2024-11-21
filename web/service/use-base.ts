import {
  useQueryClient,
} from '@tanstack/react-query'

export const useInvalid = (key: string[]) => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries(
      {
        queryKey: key,
      })
  }
}
