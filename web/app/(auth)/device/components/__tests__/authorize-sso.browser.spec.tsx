import { renderDevicePage } from '../../__tests__/device-page-fixture'

const api = vi.hoisted(() => ({
  context: vi.fn(),
  approve: vi.fn(),
  search: new URLSearchParams(),
}))
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
vi.mock('@/service/device-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/device-flow')>()),
  fetchApprovalContext: api.context,
  approveExternal: api.approve,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.profile.get': async () => {
        throw new Error('No console session')
      },
    }),
  }
})
const context = {
  subject_email: 'gareth@company.com',
  subject_issuer: 'Okta (okta.company.com)',
  user_code: 'ABCD-3456',
  csrf_token: 'tok',
  expires_at: '2099-01-01T00:00:00Z',
}
beforeEach(() => {
  api.search = new URLSearchParams({ sso_verified: '1' })
  api.context.mockReset().mockResolvedValue(context)
  api.approve.mockReset().mockResolvedValue(undefined)
})

it('authorizes the displayed SSO identity with its server context and reaches success', async () => {
  const { screen, queryClient } = await renderDevicePage()
  onTestFinished(() => queryClient.clear())
  await expect.element(screen.getByText(context.subject_email)).toBeVisible()
  await expect.element(screen.getByText(context.subject_issuer)).toBeVisible()
  await screen.getByRole('button', { name: 'deviceFlow.authorize.approve' }).click()
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
  expect(api.approve).toHaveBeenCalledWith(context, context.user_code)
})

it('shows an invalid session when the server cannot supply an approval identity', async () => {
  api.context.mockRejectedValueOnce(new Error('network'))
  const { screen, queryClient } = await renderDevicePage()
  onTestFinished(() => queryClient.clear())
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.authorize.sessionInvalidTitle' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'deviceFlow.authorize.approve' }))
    .not.toBeInTheDocument()
})

it('retains the SSO identity on approval failure and succeeds after retry', async () => {
  api.approve.mockRejectedValueOnce(new Error('unexpected'))
  const { screen, queryClient } = await renderDevicePage()
  onTestFinished(() => queryClient.clear())
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
