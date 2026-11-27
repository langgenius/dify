/** Per-request hooks captured by the feature that owns the active surface. */
export type RequestGuard = {
  beforeRequest: () => void
  isActive: () => boolean
  /** Whether the guard presented the failure, so nothing else reports it. */
  handleError: (status: number, data: unknown, error: object) => boolean
}

type RequestGuardFactory = (
  url: string,
  isPublicAPI: boolean,
  method: string,
) => RequestGuard | undefined

const requestGuardFactories = new Set<RequestGuardFactory>()

/** Register at the feature entrypoint, before its request owners mount. */
export function registerRequestGuard(factory: RequestGuardFactory) {
  requestGuardFactories.add(factory)
}

/** The guards that own a request, combined: every one must stay active, any one may present. */
export function captureRequestGuard(
  url: string,
  isPublicAPI = false,
  method = 'GET',
): RequestGuard | undefined {
  const guards = [...requestGuardFactories].flatMap((factory) => {
    const guard = factory(url, isPublicAPI, method)
    return guard ? [guard] : []
  })
  if (guards.length <= 1) return guards[0]
  return {
    beforeRequest: () => guards.forEach((guard) => guard.beforeRequest()),
    isActive: () => guards.every((guard) => guard.isActive()),
    handleError: (status, data, error) =>
      guards.some((guard) => guard.handleError(status, data, error)),
  }
}
