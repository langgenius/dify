import type { WebAppEntryState } from '../webapp-entry'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import MyAppsLink from '../my-apps-link'
import { getWebAppEntryState, WebAppEntryContext } from '../webapp-entry'

const deployment = vi.hoisted(() => ({
  basePath: '',
}))

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return deployment.basePath
  },
}))

const parameters = {
  account_login_enabled: true,
  account_login_url: 'https://console.example.com/signin',
  allow_anonymous_end_user_auth: true,
  requires_end_user_connections: false,
  connection_revision: null,
  connection_requirements: [],
}

function signedInEntry(accountLoginUrl: string | null = parameters.account_login_url) {
  return getWebAppEntryState({
    parameters: { ...parameters, account_login_url: accountLoginUrl },
    loginStatus: { logged_in: true, app_logged_in: true },
    canAccess: true,
    appDataReady: true,
    hasError: false,
  })
}

function navigation(entry: WebAppEntryState | null) {
  return (
    <WebAppEntryContext value={entry}>
      <MyAppsLink />
    </WebAppEntryContext>
  )
}

describe('Webapp My apps navigation', () => {
  beforeEach(() => {
    deployment.basePath = ''
  })

  it('offers local My apps navigation for an authenticated account without connection requirements, then removes it after logout', () => {
    const { rerender } = render(navigation(signedInEntry()))
    expect(screen.getByRole('link', { name: 'app.endUser.myApps' })).toHaveAttribute(
      'href',
      '/my-apps',
    )

    rerender(
      navigation(
        getWebAppEntryState({
          parameters,
          loginStatus: { logged_in: false, app_logged_in: true },
          canAccess: true,
          appDataReady: true,
          hasError: false,
        }),
      ),
    )
    expect(screen.queryByRole('link', { name: 'app.endUser.myApps' })).not.toBeInTheDocument()
  })

  it.each([
    null,
    { status: 'loading', canRun: false, showSignIn: false },
    { status: 'unavailable', canRun: false, showSignIn: false },
    { status: 'ready', account: 'loading', parameters, canRun: true, showSignIn: false },
    { status: 'ready', account: 'unavailable', parameters, canRun: true, showSignIn: false },
  ] satisfies (WebAppEntryState | null)[])(
    'does not offer account navigation before a signed-in account is established (%j)',
    (entry) => {
      render(navigation(entry))
      expect(screen.queryByRole('link', { name: 'app.endUser.myApps' })).not.toBeInTheDocument()
    },
  )

  it('keeps navigation on the Webapp when sign-in points to a different Console domain', () => {
    render(
      navigation(
        signedInEntry(
          'https://console.example.com/console/signin?redirect_url=private&is_end_user=1#login',
        ),
      ),
    )
    expect(screen.getByRole('link', { name: 'app.endUser.myApps' })).toHaveAttribute(
      'href',
      '/my-apps',
    )
  })

  it('preserves the Webapp deployment base path', () => {
    deployment.basePath = '/webapp/'
    render(navigation(signedInEntry()))
    expect(screen.getByRole('link', { name: 'app.endUser.myApps' })).toHaveAttribute(
      'href',
      '/webapp/my-apps',
    )
  })
})
