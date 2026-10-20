/** Per-request hooks captured by the feature that owns the active surface. */
export type RequestGuard = {
  beforeRequest: () => void
  isActive: () => boolean
  handleError: (status: number, data: unknown, error: object) => boolean
}

type RequestGuardFactory = (
  url: string,
  isPublicAPI: boolean,
  method: string,
) => RequestGuard | undefined

let requestGuardFactory: RequestGuardFactory | undefined

/** Register at the feature entrypoint, before its request owners mount. */
export function registerRequestGuard(factory: RequestGuardFactory) {
  requestGuardFactory = factory
}

export function captureRequestGuard(url: string, isPublicAPI = false, method = 'GET') {
  return requestGuardFactory?.(url, isPublicAPI, method)
}
