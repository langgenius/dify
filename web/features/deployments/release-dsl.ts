import { API_PREFIX } from '@/config'

type ReleaseDslResponse = {
  data: string
}

function releaseDslUrl(releaseId: string) {
  return `${API_PREFIX}/enterprise/app-deploy/releases/${encodeURIComponent(releaseId)}/dsl`
}

function isReleaseDslResponse(value: unknown): value is ReleaseDslResponse {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { data?: unknown }).data === 'string',
  )
}

async function fetchReleaseDslResponse(releaseId: string) {
  const response = await globalThis.fetch(releaseDslUrl(releaseId), {
    credentials: 'include',
  })

  if (!response.ok)
    throw response

  return response
}

export async function fetchReleaseDsl(releaseId: string) {
  const response = await fetchReleaseDslResponse(releaseId)
  const payload: unknown = await response.json()

  if (!isReleaseDslResponse(payload))
    throw new Error('Invalid release DSL response')

  return payload.data
}
