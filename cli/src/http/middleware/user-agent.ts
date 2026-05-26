import type { BeforeRequestHook } from 'ky'

export function applyUserAgent(value: string): BeforeRequestHook {
  return ({ request }) => {
    if (!request.headers.has('user-agent'))
      request.headers.set('user-agent', value)
  }
}
