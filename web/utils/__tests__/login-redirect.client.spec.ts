import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceLoginRedirect } from '../login-redirect.client'

describe('replaceLoginRedirect', () => {
  const routerReplace = vi.fn()
  const locationReplace = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('location', {
      ...window.location,
      replace: locationReplace,
    } as unknown as Location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['/', '', '/'],
    ['/apps?tag=agent#latest', '/console', '/apps?tag=agent#latest'],
    ['/console/apps?tag=agent#latest', '/console', '/apps?tag=agent#latest'],
    ['/console?tag=agent#latest', '/console/', '/?tag=agent#latest'],
    ['/console-apps', '/console', '/console-apps'],
    ['/console//evil.example', '/console', '/'],
    ['/console/%2Fevil.example', '/console', '/'],
    ['/console/%252Fevil.example', '/console', '/'],
    ['/console/\\evil.example', '/console', '/'],
  ])(
    'should navigate the internal target %s with basePath %s as %s',
    (href, basePath, expected) => {
      replaceLoginRedirect({ kind: 'internal', href }, routerReplace, basePath)

      expect(routerReplace).toHaveBeenCalledWith(expected)
      expect(locationReplace).not.toHaveBeenCalled()
    },
  )

  it('should replace the browser location for an absolute target', () => {
    replaceLoginRedirect(
      { kind: 'absolute', href: 'https://cloud.dify.ai/apps' },
      routerReplace,
      '/console',
    )

    expect(locationReplace).toHaveBeenCalledWith('https://cloud.dify.ai/apps')
    expect(routerReplace).not.toHaveBeenCalled()
  })
})
