import { describe, expect, it } from 'vite-plus/test'
import { resolveEndUserAccountRedirect } from '../end-user-login'

const consoleOrigin = 'https://console.example.test'
const webappUrl = 'https://webapp.example.test/web'

describe('resolved End User login destination', () => {
  it('keeps the backend-resolved WebApp path when the Console and WebApp share a host', () => {
    const target = '/web/connections?sort=recent&q=a%26b#details'

    expect(resolveEndUserAccountRedirect(target, '/web', consoleOrigin)).toBe(
      `${consoleOrigin}${target}`,
    )
  })

  it('allows a legacy absolute destination on the Console origin', () => {
    const target = `${consoleOrigin}/console/my-apps`

    expect(resolveEndUserAccountRedirect(target, webappUrl, consoleOrigin)).toBe(target)
  })

  it.each(['//webapp.example.test/my-apps', 'https://docs.dify.ai/my-apps'])(
    'rejects a destination outside the configured absolute URL contract: %s',
    (target) => {
      expect(resolveEndUserAccountRedirect(target, webappUrl, consoleOrigin)).toBeNull()
    },
  )
})
