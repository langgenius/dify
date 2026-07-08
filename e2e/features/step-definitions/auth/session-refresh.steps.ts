import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

const consoleAccessTokenCookieName = /^(?:__Host-)?access_token$/
const consoleRefreshTokenCookieName = /^(?:__Host-)?refresh_token$/

Given('my console session requires token refresh', async function (this: DifyWorld) {
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized for this scenario.')

  const cookies = await this.context.cookies()
  const hasAccessToken = cookies.some(cookie => consoleAccessTokenCookieName.test(cookie.name))
  const hasRefreshToken = cookies.some(cookie => consoleRefreshTokenCookieName.test(cookie.name))

  expect(hasAccessToken, 'Expected the authenticated E2E session to include a console access token.').toBe(true)
  expect(hasRefreshToken, 'Expected the authenticated E2E session to include a console refresh token.').toBe(true)

  await this.context.clearCookies({ name: consoleAccessTokenCookieName })

  const remainingCookies = await this.context.cookies()
  expect(
    remainingCookies.some(cookie => consoleAccessTokenCookieName.test(cookie.name)),
    'Expected the console access token to be removed before opening the default console entry.',
  ).toBe(false)
  expect(
    remainingCookies.some(cookie => consoleRefreshTokenCookieName.test(cookie.name)),
    'Expected the console refresh token to remain available for server-side refresh.',
  ).toBe(true)
})

When('I open the default console entry after the access token expires', async function (this: DifyWorld) {
  const page = this.getPage()
  const refreshRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname.endsWith('/auth/refresh') && url.searchParams.get('redirect_url') === '/'
  })

  await page.goto('/')

  const refreshRequest = await refreshRequestPromise
  this.attach(`Session refresh request: ${refreshRequest.url()}`, 'text/plain')
})
