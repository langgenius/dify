// eslint-disable-next-line no-restricted-imports -- streaming SSE has no generated contract; ssePost + its callback types only live in service/base
import type { IOnCompleted, IOnData, IOnError } from '@/service/base'
// eslint-disable-next-line no-restricted-imports -- streaming SSE has no generated contract; ssePost only lives in service/base
import { ssePost } from '@/service/base'

/**
 * Feature-specific service for the isolated AI Page Generator.
 *
 * Wraps the shared `ssePost` streaming client so the page component depends on
 * a feature module (per repo convention) instead of importing `service/base`
 * directly. The backend endpoint `/console/api/page-generate` emits an SSE
 * envelope with `event: 'message' | 'message_end' | 'error'`, which the shared
 * `handleStream` maps onto these callbacks.
 */
export const generatePage = async (
  description: string,
  callbacks: {
    onData: IOnData
    onCompleted: IOnCompleted
    onError: IOnError
  },
) => {
  return ssePost(
    'page-generate',
    { body: { description } },
    callbacks,
  )
}
