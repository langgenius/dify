import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import SignInPage from '../sign-in-page'

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  request: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({ useSearchParams: () => mocks.searchParams }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mocks.request,
}))
vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: vi.fn() }))

it('keeps account login blocked after logout fails and lets the user retry', async () => {
  const retry = createDeferred<Response>()
  mocks.searchParams = new URLSearchParams({
    is_end_user: '1',
    app_code: 'current-app',
    redirect_url: 'https://apps.example/chat/current-app',
    code_challenge: 'a'.repeat(43),
    switch_account: '1',
  })
  mocks.request
    .mockReset()
    .mockRejectedValueOnce(new Error('Logout failed'))
    .mockReturnValueOnce(retry.promise)
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <StrictMode>
        <SignInPage />
      </StrictMode>
    </QueryClientProvider>,
  )

  await expect.element(screen.getByRole('alert')).toHaveTextContent('Logout failed')
  expect(mocks.request).toHaveBeenCalledOnce()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  expect(mocks.request).toHaveBeenCalledTimes(2)
  expect(mocks.request.mock.calls.every(([url]) => new URL(url).pathname.endsWith('/logout'))).toBe(
    true,
  )
})
