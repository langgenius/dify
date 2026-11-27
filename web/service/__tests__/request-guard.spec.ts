import type { RequestGuard } from '../request-guard'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const guard = (overrides: Partial<RequestGuard> = {}): RequestGuard => ({
  beforeRequest: vi.fn(),
  isActive: () => true,
  handleError: () => false,
  ...overrides,
})

const loadRegistry = async () => {
  vi.resetModules()
  return import('../request-guard')
}

describe('request guards', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('captures no guard when no owner claims the request', async () => {
    const { captureRequestGuard, registerRequestGuard } = await loadRegistry()
    registerRequestGuard(() => undefined)

    expect(captureRequestGuard('/apps')).toBeUndefined()
  })

  it('combines every owner that claims the request', async () => {
    const { captureRequestGuard, registerRequestGuard } = await loadRegistry()
    const access = guard({ isActive: () => true, handleError: (status) => status === 403 })
    const deletion = guard({ handleError: (status) => status === 404 })
    registerRequestGuard(() => access)
    registerRequestGuard(() => deletion)

    const combined = captureRequestGuard('/apps/a/workflows/draft')!
    combined.beforeRequest()

    expect(access.beforeRequest).toHaveBeenCalledOnce()
    expect(deletion.beforeRequest).toHaveBeenCalledOnce()
    expect(combined.handleError(404, undefined, {})).toBe(true)
    expect(combined.handleError(403, undefined, {})).toBe(true)
    expect(combined.handleError(500, undefined, {})).toBe(false)
  })

  it('is inactive once any owner is', async () => {
    const { captureRequestGuard, registerRequestGuard } = await loadRegistry()
    registerRequestGuard(() => guard())
    registerRequestGuard(() => guard({ isActive: () => false }))

    expect(captureRequestGuard('/apps')!.isActive()).toBe(false)
  })
})
