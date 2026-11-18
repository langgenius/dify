import { userEvent } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { apiError, installFakeApi, route } from '@/test/fake-api'
import { renderDevicePage } from '../../__tests__/device-page-fixture'

const api = vi.hoisted(() => ({ search: new URLSearchParams() }))
const approveAccount = vi.fn<(userCode: string) => unknown>()
const denyAccount = vi.fn<(userCode: string) => unknown>()
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
const userCode = async (request: Request) =>
  ((await request.json()) as { user_code: string }).user_code
beforeEach(() => {
  onTestFinished(
    installFakeApi({
      routes: [
        route('POST', 'origin', '/openapi/v1/oauth/device/approve', async ({ request }) =>
          approveAccount(await userCode(request)),
        ),
        route('POST', 'origin', '/openapi/v1/oauth/device/deny', async ({ request }) =>
          denyAccount(await userCode(request)),
        ),
      ],
    }),
  )
  api.search = new URLSearchParams({ user_code: 'ABCD-3456' })
  approveAccount.mockReset().mockResolvedValue({ status: 'approved' })
  denyAccount.mockReset().mockResolvedValue({ status: 'denied' })
})

it.each(['approve', 'deny'] as const)(
  'finishes %s only after the request succeeds and locks both actions while pending',
  async (action) => {
    const pending = createDeferred<unknown>()
    const request = action === 'approve' ? approveAccount : denyAccount
    request.mockReturnValueOnce(pending.promise)
    const { screen } = await renderDevicePage({ signedIn: true })
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
    await vi.waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith('ABCD-3456'))
    pending.resolve({ status: action === 'approve' ? 'approved' : 'denied' })
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

// TODO(https://github.com/langgenius/dify/issues/46700): pending Approve drops keyboard focus to <body>.
it.fails('keeps the account and code available after failure and completes a native keyboard retry', async () => {
  approveAccount.mockRejectedValueOnce(
    apiError('unexpected', 400, 'Unexpected', { error: 'unexpected' }),
  )
  const { screen } = await renderDevicePage({ signedIn: true })
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await approve.click()
  await expect.element(screen.getByText('deviceFlow.approveError.default')).toBeVisible()
  await expect.element(approve).toBeEnabled()
  await expect.element(screen.getByText('gareth@example.com')).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }), { timeout: 1000 })
    .toBeVisible()
  expect(approveAccount).toHaveBeenLastCalledWith('ABCD-3456')
})
