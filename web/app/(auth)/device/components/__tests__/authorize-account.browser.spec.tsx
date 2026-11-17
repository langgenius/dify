import { userEvent } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { renderDevicePage } from '../../__tests__/device-page-fixture'

const api = vi.hoisted(() => ({ approve: vi.fn(), deny: vi.fn(), search: new URLSearchParams() }))
// boundary: Next routing supplies the authorization landing URL in the running app.
vi.mock('@/next/navigation', () => ({
  useSearchParams: () => api.search,
  useRouter: () => ({
    replace: () => {
      api.search = new URLSearchParams()
    },
  }),
  usePathname: () => '/device',
}))
vi.mock('@/service/device-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/device-flow')>()),
  deviceApproveAccount: api.approve,
  deviceDenyAccount: api.deny,
}))
beforeEach(() => {
  api.search = new URLSearchParams({ user_code: 'ABCD-3456' })
  api.approve.mockReset().mockResolvedValue(undefined)
  api.deny.mockReset().mockResolvedValue(undefined)
})

it.each(['approve', 'deny'] as const)(
  'finishes %s only after the request succeeds and locks both actions while pending',
  async (action) => {
    const pending = createDeferred<void>()
    const request = action === 'approve' ? api.approve : api.deny
    request.mockReturnValueOnce(pending.promise)
    const { screen, queryClient } = await renderDevicePage({ signedIn: true })
    onTestFinished(() => queryClient.clear())
    await expect.element(screen.getByText('Gareth Chen')).toBeVisible()
    await expect.element(screen.getByText('gareth@example.com')).toBeVisible()
    await expect.element(screen.getByText('Dify Enterprise')).toBeVisible()
    const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
    const deny = screen.getByRole('button', { name: 'common.operation.cancel' })
    await (action === 'approve' ? approve : deny).click()
    await expect.element(approve).toBeDisabled()
    await expect.element(deny).toBeDisabled()
    await expect
      .element(screen.getByRole('heading', { name: 'deviceFlow.authorize.title' }))
      .toBeVisible()
    expect(request).toHaveBeenCalledExactlyOnceWith('ABCD-3456')
    pending.resolve()
    await expect
      .element(
        screen.getByRole('heading', {
          name: action === 'approve' ? 'deviceFlow.success.title' : 'deviceFlow.errorExpired.title',
        }),
      )
      .toBeVisible()
    await expect.element(approve).not.toBeInTheDocument()
    if (action === 'approve')
      await expect
        .element(screen.getByRole('link', { name: 'deviceFlow.success.goToConsole' }))
        .toHaveAttribute('href', '/')
  },
)

it('keeps the account and code available after failure and completes a native keyboard retry', async () => {
  api.approve.mockRejectedValueOnce(new Error('unexpected'))
  const { screen, queryClient } = await renderDevicePage({ signedIn: true })
  onTestFinished(() => queryClient.clear())
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await approve.click()
  await expect.element(screen.getByText('deviceFlow.approveError.default')).toBeVisible()
  await expect.element(approve).toBeEnabled()
  await expect.element(screen.getByText('gareth@example.com')).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
  expect(api.approve).toHaveBeenLastCalledWith('ABCD-3456')
})
