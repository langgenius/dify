import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ACCESS_TOKEN_LOCAL_STORAGE_NAME } from '@/config'
import { webAppLogout } from './common'
import {
  getWebAppPassport,
  setWebAppAccessToken,
  setWebAppPassport,
  webAppLoginStatus,
} from './webapp-auth'

const webAppClientMock = vi.hoisted(() => ({
  login: { status: { get: vi.fn() } },
  logout: { post: vi.fn() },
}))

vi.mock('./webapp', () => ({ webAppClient: webAppClientMock }))

describe('webAppLoginStatus', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    webAppClientMock.login.status.get.mockReset()
    webAppClientMock.login.status.get.mockResolvedValue({ logged_in: true, app_logged_in: true })
  })
  afterEach(() => {
    window.history.replaceState({}, '', originalUrl)
  })

  it('does not add an app code query to environment login status', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')

    await webAppLoginStatus('workflow-app', 'user-1')

    expect(webAppClientMock.login.status.get).toHaveBeenCalledWith({
      query: { user_id: 'user-1' },
    })
  })

  it('uses the authoritative environment login state', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')
    webAppClientMock.login.status.get.mockResolvedValue({ logged_in: false, app_logged_in: false })

    await expect(webAppLoginStatus('workflow-app')).resolves.toEqual({
      userLoggedIn: false,
      appLoggedIn: false,
    })
  })

  it('trusts the remote login state for an sso verified environment', async () => {
    window.history.replaceState({}, '', '/environment/workflow/workflow-app')
    webAppClientMock.login.status.get.mockResolvedValue({ logged_in: true, app_logged_in: false })

    await expect(webAppLoginStatus('workflow-app')).resolves.toEqual({
      userLoggedIn: true,
      appLoggedIn: false,
    })
  })

  it('keeps the app code for ordinary webapps', async () => {
    window.history.replaceState({}, '', '/workflow/workflow-app')

    await webAppLoginStatus('workflow-app')

    expect(webAppClientMock.login.status.get).toHaveBeenCalledWith({
      query: { app_code: 'workflow-app' },
    })
  })
})

describe('webAppLogout', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('clears the stored account credentials after remote logout', async () => {
    const address = { kind: 'default' as const, code: 'workflow-app' }
    setWebAppAccessToken('access-token', 'end_user')
    setWebAppPassport(address, 'passport')
    webAppClientMock.logout.post.mockResolvedValue({ result: 'success' })

    await webAppLogout(address)

    expect(localStorage.getItem(ACCESS_TOKEN_LOCAL_STORAGE_NAME)).toBeNull()
    expect(getWebAppPassport(address)).toBe('')
    expect(webAppClientMock.logout.post).toHaveBeenCalledOnce()
  })
})
