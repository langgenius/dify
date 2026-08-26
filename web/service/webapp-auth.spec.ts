import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AccessMode } from '@/models/access-control'

const getPublicMock = vi.hoisted(() => vi.fn())

vi.mock('./base', () => ({
  getPublic: getPublicMock,
  postPublic: vi.fn(),
}))

const { getWebAppPassport, setWebAppPassport, webAppLoginStatus } = await import('./webapp-auth')

describe('webAppLoginStatus', () => {
  beforeEach(() => {
    getPublicMock.mockReset()
    getPublicMock.mockResolvedValue({ logged_in: true, app_logged_in: true })
    localStorage.clear()
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

  it('does not send an environment code to Dify login status', async () => {
    window.history.replaceState({}, '', '/env/workflow/workflow-app')

    await webAppLoginStatus('workflow-app', AccessMode.PUBLIC, 'user-1')

    expect(getPublicMock).toHaveBeenCalledWith('/login/status?user_id=user-1')
  })

  it('treats a public environment as logged in before its first passport', async () => {
    window.history.replaceState({}, '', '/env/workflow/workflow-app')
    getPublicMock.mockResolvedValue({ logged_in: false, app_logged_in: false })

    await expect(webAppLoginStatus('workflow-app', AccessMode.PUBLIC)).resolves.toEqual({
      userLoggedIn: true,
      appLoggedIn: false,
    })
  })

  it('trusts the remote login state for an sso verified environment', async () => {
    window.history.replaceState({}, '', '/env/workflow/workflow-app')
    getPublicMock.mockResolvedValue({ logged_in: true, app_logged_in: false })

    await expect(webAppLoginStatus('workflow-app', AccessMode.EXTERNAL_MEMBERS)).resolves.toEqual({
      userLoggedIn: true,
      appLoggedIn: false,
    })
  })

  it('requires a Dify login for a private environment', async () => {
    window.history.replaceState({}, '', '/env/workflow/workflow-app')
    getPublicMock.mockResolvedValue({ logged_in: false, app_logged_in: false })

    await expect(
      webAppLoginStatus('workflow-app', AccessMode.SPECIFIC_GROUPS_MEMBERS),
    ).resolves.toEqual({
      userLoggedIn: false,
      appLoggedIn: false,
    })
  })

  it('keeps the app code for ordinary webapps', async () => {
    window.history.replaceState({}, '', '/workflow/workflow-app')

    await webAppLoginStatus('workflow-app', AccessMode.PUBLIC)

    expect(getPublicMock).toHaveBeenCalledWith('/login/status?app_code=workflow-app')
  })
})
