import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { getEndUserAccountRedirectUrl, getEndUserLoginContext } from '../end-user-login'

const config = vi.hoisted(() => ({ basePath: '' }))

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return config.basePath
  },
}))

describe('personal portal sign-in context', () => {
  beforeEach(() => {
    config.basePath = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['', '/portal'])(
    'accepts a relative My apps target during SSR with base path %s',
    (basePath) => {
      config.basePath = basePath
      vi.stubGlobal('location', undefined)
      const redirectUrl = `${basePath}/my-apps`

      expect(
        getEndUserLoginContext(
          new URLSearchParams({ is_end_user: '1', redirect_url: redirectUrl }),
        ),
      ).toEqual({ mode: 'end_user', redirect_url: redirectUrl })
    },
  )

  it.each([
    'https://external.example/my-apps',
    '//external.example/my-apps',
    'javascript:alert(1)',
  ])('rejects an unsafe personal destination in the browser: %s', (redirectUrl) => {
    expect(
      getEndUserLoginContext(new URLSearchParams({ is_end_user: '1', redirect_url: redirectUrl })),
    ).toBeNull()
  })

  it('resolves the relative personal login response on the current browser origin', () => {
    const context = getEndUserLoginContext(
      new URLSearchParams({ is_end_user: '1', redirect_url: '/my-apps' }),
    )

    expect(getEndUserAccountRedirectUrl('/my-apps', context)).toBe(
      new URL('/my-apps', location.origin).href,
    )
  })
})
