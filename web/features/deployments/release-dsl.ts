import { API_PREFIX } from '@/config'

function releaseDslUrl(releaseId: string) {
  return `${API_PREFIX}/enterprise/app-deploy/releases/${encodeURIComponent(releaseId)}/dsl`
}

export async function fetchReleaseDslResponse(releaseId: string) {
  const response = await globalThis.fetch(releaseDslUrl(releaseId), {
    credentials: 'include',
  })

  if (!response.ok)
    throw response

  return response
}

export async function fetchReleaseDsl(releaseId: string) {
  const response = await fetchReleaseDslResponse(releaseId)

  return response.text()
}
