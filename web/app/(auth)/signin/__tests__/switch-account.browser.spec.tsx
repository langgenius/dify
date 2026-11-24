import { StrictMode } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, pendingResponse, route, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import SignInPage from '../sign-in-page'

vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: vi.fn() }))

const logout = vi.fn()
const fake = setupFakeApi({ routes: [route('POST', 'console', '/logout', logout)] })

it('keeps account login blocked after logout fails and lets the user retry', async () => {
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

  await expect.element(screen.getByRole('alert')).toHaveTextContent('Logout failed')
  expect(fake.route('POST', 'console', '/logout')).toHaveBeenCalledOnce()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  expect(fake.route('POST', 'console', '/logout')).toHaveBeenCalledTimes(2)
})
