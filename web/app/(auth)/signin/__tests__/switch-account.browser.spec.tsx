import { StrictMode } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, pendingResponse, route, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import SignInPage from '../sign-in-page'

// boundary: keeps the logout integration independent of analytics side effects.
vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: vi.fn() }))

const logout = vi.fn()
const fake = setupFakeApi({ routes: [route('POST', 'console', '/logout', logout)] })

it('asks before logging out and lets the user retry a failed logout', async () => {
  const params = new URLSearchParams({
    is_end_user: '1',
    app_code: 'current-app',
    redirect_url: '/chat/current-app',
    code_challenge: 'a'.repeat(43),
    switch_account: '1',
  })
  logout
    .mockReset()
    .mockRejectedValueOnce(apiError({ status: 503, message: 'Logout failed' }))
    .mockImplementationOnce(pendingResponse)
  const { NavigationProvider } = createTestNavigation({ url: `/signin?${params}` })
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    systemFeatures: { webapp_url: 'https://apps.example' },
  })
  const screen = await render(
    <Wrapper>
      <NavigationProvider>
        <StrictMode>
          <SignInPage />
        </StrictMode>
      </NavigationProvider>
    </Wrapper>,
  )

  const switchAccount = screen.getByRole('button', { name: 'oauth.switchAccount' })
  await expect.element(switchAccount).toBeEnabled()
  expect(fake.route('POST', 'console', '/logout')).not.toHaveBeenCalled()
  await switchAccount.click()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Logout failed')
  expect(fake.route('POST', 'console', '/logout')).toHaveBeenCalledOnce()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(switchAccount).toHaveAttribute('aria-disabled', 'true')
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  expect(fake.route('POST', 'console', '/logout')).toHaveBeenCalledTimes(2)
})
