import { skipToken, useQuery } from '@tanstack/react-query'

export function useFetchTextContent(downloadUrl: string | undefined) {
  return useQuery({
    queryKey: ['fileTextContent', downloadUrl],
    queryFn: downloadUrl
      ? () => fetch(downloadUrl).then(r => r.text())
      : skipToken,
    staleTime: Infinity,
  })
}
