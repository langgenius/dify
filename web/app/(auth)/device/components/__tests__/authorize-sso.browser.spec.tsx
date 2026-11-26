import { userEvent } from 'vite-plus/test/browser'
import { apiError, hold, route, setupFakeApi } from '@/test/fake-api'
import { renderDevicePage } from '../../__tests__/device-page-fixture'

const landingUrl = '/device?sso_verified=1'

const context = {
  subject_email: 'gareth@company.com',
  subject_issuer: 'Okta (okta.company.com)',
  user_code: 'ABCD-3456',
  csrf_token: 'tok',
  expires_at: '2099-01-01T00:00:00Z',
}
const approvalContextPath = '/openapi/v1/oauth/device/approval-context'
const approveExternalPath = '/openapi/v1/oauth/device/approve-external'
const fake = setupFakeApi(() => ({
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
    route('GET', 'origin', approvalContextPath, () => context),
    route('POST', 'origin', approveExternalPath, () => ({})),
  ],
}))

it('authorizes the displayed SSO identity with its server context and reaches success', async () => {
  const { screen } = await renderDevicePage({ url: landingUrl })
  await expect.element(screen.getByText(context.subject_email)).toBeVisible()
  await expect.element(screen.getByText(context.subject_issuer)).toBeVisible()
  await screen.getByRole('button', { name: 'deviceFlow.authorize.approve' }).click()
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
  const approve = fake.route('POST', 'origin', approveExternalPath)
  expect(approve).toHaveBeenCalledWith(
    expect.objectContaining({ body: { user_code: context.user_code } }),
  )
  expect(approve.mock.calls[0]![0].request.headers.get('X-CSRF-Token')).toBe(context.csrf_token)
})

it('shows an invalid session when the server cannot supply an approval identity', async () => {
  fake.route('GET', 'origin', approvalContextPath).mockRejectedValueOnce(
    apiError({
      status: 500,
      code: 'server_error',
      message: 'Server error',
      details: { error: 'server_error' },
    }),
  )
  const { screen } = await renderDevicePage({ url: landingUrl })
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.authorize.sessionInvalidTitle' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'deviceFlow.authorize.approve' }))
    .not.toBeInTheDocument()
})

it('retains the SSO identity on approval failure and succeeds after retry', async () => {
  fake.route('POST', 'origin', approveExternalPath).mockRejectedValueOnce(
    apiError({
      status: 400,
      code: 'unexpected',
      message: 'Unexpected',
      details: { error: 'unexpected' },
    }),
  )
  const { screen } = await renderDevicePage({ url: landingUrl })
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

it('keeps focus on the pending approval so a keyboard retry works after failure', async () => {
  const request = fake.route('POST', 'origin', approveExternalPath)
  const pending = hold(request)
  const { screen } = await renderDevicePage({ url: landingUrl })
  await expect.element(screen.getByText(context.subject_email)).toBeVisible()
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await approve.click()
  await expect.element(approve).toHaveAttribute('aria-disabled', 'true')
  const button = await approve.element()
  expect(document.activeElement).toBe(button)
  // Reject only once the request reached the server, so the rejection always has a listener.
  await expect.poll(() => request.mock.calls.length).toBe(1)
  pending.reject(
    apiError({
      status: 400,
      code: 'unexpected',
      message: 'Unexpected',
      details: { error: 'unexpected' },
    }),
  )
  await expect.element(screen.getByText('deviceFlow.approveError.default')).toBeVisible()
  await expect.element(approve).toBeEnabled()
  expect(document.activeElement).toBe(button)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
  expect(request).toHaveBeenCalledTimes(2)
})
