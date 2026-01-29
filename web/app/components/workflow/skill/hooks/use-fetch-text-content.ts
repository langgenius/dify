import { useQuery } from '@tanstack/react-query'

export function useFetchTextContent(downloadUrl: string | undefined) {
  return useQuery({
    queryKey: ['fileTextContent', downloadUrl],
    queryFn: () => fetch(downloadUrl!).then(r => r.text()),
    enabled: !!downloadUrl,
    staleTime: Infinity,
  })
}
