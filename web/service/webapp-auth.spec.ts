import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
const getPublicMock = vi.hoisted(() => vi.fn())

vi.mock('./base', () => ({
  getPublic: getPublicMock,
  postPublic: vi.fn(),
}))

const {
  beginWebAppAuthorizationRecovery,
  completeWebAppAuthorizationRecovery,
  getOrCreateWebAppSessionId,
  getWebAppPassport,
  setWebAppPassport,
  webAppLoginStatus,
} = await import('./webapp-auth')

describe('webAppLoginStatus', () => {
  beforeEach(() => {
    getPublicMock.mockReset()
    getPublicMock.mockResolvedValue({ logged_in: true, app_logged_in: true })
    localStorage.clear()
    sessionStorage.clear()
  })

  it('keeps environment and ordinary passports for the same code separate', () => {
    const environment = { kind: 'environment' as const, code: 'workflow-app' }
    const ordinary = { kind: 'default' as const, code: 'workflow-app' }

    setWebAppPassport(environment, 'environment-passport')
    setWebAppPassport(ordinary, 'ordinary-passport')

    expect(getWebAppPassport(environment)).toBe('environment-passport')
    expect(getWebAppPassport(ordinary)).toBe('ordinary-passport')
  })

  it('keeps the ordinary webapp passport storage key unchanged', () => {
    const address = { kind: 'default' as const, code: 'workflow-app' }

    setWebAppPassport(address, 'passport')

    expect(localStorage.getItem('passport-workflow-app')).toBe('passport')
  })

  it('keeps a stable user id for each environment', () => {
    const firstEnvironment = { kind: 'environment' as const, code: 'environment-1' }
    const secondEnvironment = { kind: 'environment' as const, code: 'environment-2' }

    const first = getOrCreateWebAppSessionId(firstEnvironment)

    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getOrCreateWebAppSessionId(firstEnvironment)).toBe(first)
    expect(getOrCreateWebAppSessionId(secondEnvironment)).not.toBe(first)
    expect(localStorage.getItem('session_id-environment:environment-1')).toBe(first)
  })

  it('allows one authorization recovery until an environment request succeeds', () => {
    const address = { kind: 'environment' as const, code: 'environment-1' }

    expect(beginWebAppAuthorizationRecovery(address)).toBe(true)
    expect(beginWebAppAuthorizationRecovery(address)).toBe(false)

    setWebAppPassport(address, 'renewed-passport')

    expect(beginWebAppAuthorizationRecovery(address)).toBe(false)

    completeWebAppAuthorizationRecovery(address)

    expect(beginWebAppAuthorizationRecovery(address)).toBe(true)
  })

  it('does not add an app code query to environment login status', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')

    await webAppLoginStatus('workflow-app', 'user-1')

    expect(getPublicMock).toHaveBeenCalledWith('/login/status?user_id=user-1')
  })

  it('uses the authoritative environment login state', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')
    getPublicMock.mockResolvedValue({ logged_in: false, app_logged_in: false })

    await expect(webAppLoginStatus('workflow-app')).resolves.toEqual({
      userLoggedIn: false,
      appLoggedIn: false,
    })
  })

  it('trusts the remote login state for an sso verified environment', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')
    getPublicMock.mockResolvedValue({ logged_in: true, app_logged_in: false })

    await expect(webAppLoginStatus('workflow-app')).resolves.toEqual({
      userLoggedIn: true,
      appLoggedIn: false,
    })
  })

  it('keeps the app code for ordinary webapps', async () => {
    window.history.replaceState({}, '', '/workflow/workflow-app')

    await webAppLoginStatus('workflow-app')

    expect(getPublicMock).toHaveBeenCalledWith('/login/status?app_code=workflow-app')
  })
})
