import { consoleClient } from '@/service/client'

export async function fetchReleaseDsl(releaseId: string) {
  const response = await consoleClient.enterprise.releaseService.exportReleaseDsl({
    params: { releaseId },
  })

  if (!response.data)
    throw new Error('Invalid release DSL response')

  return response.data
}
