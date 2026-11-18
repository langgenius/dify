import { apiError, installFakeApi, route } from '@/test/fake-api'
import { renderDevicePage } from '../../__tests__/device-page-fixture'

const api = vi.hoisted(() => ({ search: new URLSearchParams() }))
const fetchContext = vi.fn<() => unknown>()
const approveExternal =
  vi.fn<(request: { userCode: string; csrfToken: string | null }) => unknown>()
// boundary: Next routing supplies and scrubs the external SSO return URL.
vi.mock('@/next/navigation', () => ({
  useSearchParams: () => api.search,
  useRouter: () => ({
    replace: () => {
      api.search = new URLSearchParams()
    },
  }),
  usePathname: () => '/device',
}))
const context = {
  subject_email: 'gareth@company.com',
  subject_issuer: 'Okta (okta.company.com)',
  user_code: 'ABCD-3456',
  csrf_token: 'tok',
  expires_at: '2099-01-01T00:00:00Z',
}
beforeEach(() => {
  onTestFinished(
    installFakeApi({
      console: {
        account: {
          profile: {
            // The signed-out state is a failed profile probe; a 401 would start the app's
            // token refresh and sign-in redirect, which belong to the running application.
            get: () => {
              throw apiError({ status: 403, code: 'forbidden', message: 'No console session' })
            },
          },
        },
      },
      routes: [
        route('GET', 'origin', '/openapi/v1/oauth/device/approval-context', () => fetchContext()),
        route('POST', 'origin', '/openapi/v1/oauth/device/approve-external', async ({ request }) =>
          approveExternal({
            userCode: ((await request.json()) as { user_code: string }).user_code,
            csrfToken: request.headers.get('X-CSRF-Token'),
          }),
        ),
      ],
    }),
  )
  api.search = new URLSearchParams({ sso_verified: '1' })
  fetchContext.mockReset().mockResolvedValue(context)
  approveExternal.mockReset().mockResolvedValue({})
})

it('authorizes the displayed SSO identity with its server context and reaches success', async () => {
  const { screen } = await renderDevicePage()
  await expect.element(screen.getByText(context.subject_email)).toBeVisible()
  await expect.element(screen.getByText(context.subject_issuer)).toBeVisible()
  await screen.getByRole('button', { name: 'deviceFlow.authorize.approve' }).click()
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
  expect(approveExternal).toHaveBeenCalledWith({
    userCode: context.user_code,
    csrfToken: context.csrf_token,
  })
})

it('shows an invalid session when the server cannot supply an approval identity', async () => {
  fetchContext.mockRejectedValueOnce(
    apiError({
      status: 500,
      code: 'server_error',
      message: 'Server error',
      details: { error: 'server_error' },
    }),
  )
  const { screen } = await renderDevicePage()
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.authorize.sessionInvalidTitle' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'deviceFlow.authorize.approve' }))
    .not.toBeInTheDocument()
})

it('retains the SSO identity on approval failure and succeeds after retry', async () => {
  approveExternal.mockRejectedValueOnce(
    apiError({
      status: 400,
      code: 'unexpected',
      message: 'Unexpected',
      details: { error: 'unexpected' },
    }),
  )
  const { screen } = await renderDevicePage()
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await approve.click()
  await expect.element(screen.getByText('deviceFlow.approveError.default')).toBeVisible()
  await expect.element(screen.getByText(context.subject_email)).toBeVisible()
  await expect.element(approve).toBeEnabled()
  await approve.click()
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
})
