import type { BeforeRequestHook } from 'ky'

export function applyBearer(token: string | undefined): BeforeRequestHook {
  return ({ request }) => {
    if (token === undefined || token === '')
      return
    if (!request.headers.has('authorization'))
      request.headers.set('authorization', `Bearer ${token}`)
  }
}
