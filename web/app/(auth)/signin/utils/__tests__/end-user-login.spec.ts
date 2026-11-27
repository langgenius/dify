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
      const redirectUrl = '/my-apps'

      expect(
        getEndUserLoginContext(
          new URLSearchParams({ is_end_user: '1', redirect_url: redirectUrl }),
          'https://apps.example/web',
        ),
      ).toEqual({ mode: 'end_user', redirect_url: `${basePath}/my-apps` })
    },
  )

  it.each([
    'https://external.example/my-apps',
    '//external.example/my-apps',
    'javascript:alert(1)',
  ])('rejects an unsafe personal destination in the browser: %s', (redirectUrl) => {
    expect(
      getEndUserLoginContext(
        new URLSearchParams({ is_end_user: '1', redirect_url: redirectUrl }),
        'https://apps.example/web',
      ),
    ).toBeNull()
  })

  it.each(
    ['', '/console'].flatMap((basePath) =>
      ['https://apps.example/web', '/web', ''].map((webappUrl) => ({
        basePath,
        webappUrl,
      })),
    ),
  )(
    'maps the verified Console target from $basePath onto the Webapp prefix $webappUrl',
    ({ basePath, webappUrl }) => {
      config.basePath = basePath
      const route = '/my-apps?search=hello%20world&tag=workflow#recent'
      const redirectUrl = `${basePath}${route}`
      const context = getEndUserLoginContext(
        new URLSearchParams({ is_end_user: '1', redirect_url: route }),
        webappUrl,
      )

      expect(getEndUserAccountRedirectUrl(redirectUrl, context, webappUrl)).toBe(
        new URL(`${webappUrl}${route}`, location.origin).href,
      )
      expect(context?.redirect_url).toBe(redirectUrl)
    },
  )

  it('retains the provider path, query and hash when returning to Connections', () => {
    config.basePath = '/console'
    const redirectUrl = '/console/connections/langgenius%2Fgithub%2Fgithub?view=linked#account'
    const context = getEndUserLoginContext(
      new URLSearchParams({
        is_end_user: '1',
        redirect_url: '/connections/langgenius%2Fgithub%2Fgithub?view=linked#account',
      }),
      'https://apps.example/web',
    )

    expect(getEndUserAccountRedirectUrl(redirectUrl, context, 'https://apps.example/web')).toBe(
      'https://apps.example/web/connections/langgenius%2Fgithub%2Fgithub?view=linked#account',
    )
  })

  it.each([
    'https://external.example/console/my-apps',
    'https://apps.example/my-apps',
    'https://apps.example/web/connections',
    'https://apps.example/web/my-apps?other=1',
    '//apps.example/web/my-apps',
    '//external.example/console/my-apps',
    'javascript:alert(1)',
    '/console-signin/my-apps',
    '/console/signin',
    '/console/connections',
    '/console/my-apps?other=1',
    '/console/my-apps#other',
    '/console/connections/%2E%2E',
  ])('rejects an unverified response before applying the Webapp prefix: %s', (response) => {
    config.basePath = '/console'
    const context = getEndUserLoginContext(
      new URLSearchParams({ is_end_user: '1', redirect_url: '/my-apps' }),
      'https://apps.example/web',
    )

    expect(getEndUserAccountRedirectUrl(response, context, 'https://apps.example/web')).toBeNull()
  })
  it.each(['chat', 'chatbot', 'completion', 'workflow'])(
    'resolves a public %s App path against the independent Webapp prefix for the Account API',
    (route) => {
      config.basePath = '/console'
      const path = `/${route}/my-app?input=hello%20world#turn-2`
      const challenge = 'a'.repeat(43)
      expect(
        getEndUserLoginContext(
          new URLSearchParams({
            is_end_user: '1',
            app_code: 'my-app',
            code_challenge: challenge,
            redirect_url: path,
          }),
          'https://apps.example/web',
        ),
      ).toEqual({
        mode: 'end_user',
        app_code: 'my-app',
        code_challenge: challenge,
        redirect_url: `https://apps.example/web${path}`,
      })
    },
  )

  it.each(['', '/web'])('accepts a same-origin App handoff with Webapp base "%s"', (webappUrl) => {
    const path = '/chat/my-app?input=hello%20world#turn-2'
    const context = getEndUserLoginContext(
      new URLSearchParams({
        is_end_user: '1',
        app_code: 'my-app',
        code_challenge: 'a'.repeat(43),
        redirect_url: path,
      }),
      webappUrl,
    )
    const target = `${webappUrl}${path}`
    expect(context?.redirect_url).toBe(target)
    const query = new URLSearchParams({
      redirect_url: target,
      login_code: 'one-use-code',
      mode: 'end_user',
    })
    const callback = `${webappUrl}/webapp-signin?${query}`
    const destination = new URL(target, location.origin)
    destination.searchParams.set('mode', 'end_user')
    destination.searchParams.set('login_code', 'one-use-code')
    destination.searchParams.set('redirect_url', target)

    expect(getEndUserAccountRedirectUrl(callback, context, webappUrl)).toBe(destination.href)
    expect(
      getEndUserAccountRedirectUrl(`https://external.example${callback}`, context, webappUrl),
    ).toBeNull()
  })

  it.each([
    '/web/chat/my-app',
    '/console/chat/my-app',
    '/environment/chat/my-app',
    '/chat/another-app',
    '//evil.example/chat/my-app',
    'https://apps.example/web/chat/my-app',
  ])('rejects prefixed, mismatched or non-public App paths: %s', (redirectUrl) => {
    config.basePath = '/console'
    expect(
      getEndUserLoginContext(
        new URLSearchParams({
          is_end_user: '1',
          app_code: 'my-app',
          code_challenge: 'a'.repeat(43),
          redirect_url: redirectUrl,
        }),
        'https://apps.example/web',
      ),
    ).toBeNull()
  })
})
