import { isPublicWebAppRoute } from './is-public-webapp-route'

describe('isPublicWebAppRoute', () => {
  it.each([
    '/chat/app-code',
    '/chatbot/app-code',
    '/completion/app-code',
    '/workflow/app-code',
    '/agent/app-code',
  ])('returns true for %s', (pathname) => {
    expect(isPublicWebAppRoute(pathname)).toBe(true)
  })

  it.each([
    '/',
    '/apps',
    '/signin',
    '/webapp-signin',
    '/webapp-signin/check-code',
  ])('returns false for %s', (pathname) => {
    expect(isPublicWebAppRoute(pathname)).toBe(false)
  })
})
