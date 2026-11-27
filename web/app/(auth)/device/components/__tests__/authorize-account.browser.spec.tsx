import { userEvent } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { apiError, route, setupFakeApi } from '@/test/fake-api'
import { renderDevicePage } from '../../__tests__/device-page-fixture'

const landingUrl = '/device?user_code=ABCD-3456'

const fake = setupFakeApi(() => ({
  routes: [
    route('POST', 'origin', '/openapi/v1/oauth/device/approve', () => ({ status: 'approved' })),
    route('POST', 'origin', '/openapi/v1/oauth/device/deny', () => ({ status: 'denied' })),
  ],
}))
const deviceAction = (action: 'approve' | 'deny') =>
  fake.route('POST', 'origin', `/openapi/v1/oauth/device/${action}`)
const withCode = expect.objectContaining({ body: { user_code: 'ABCD-3456' } })

it.each(['approve', 'deny'] as const)(
  'finishes %s only after the request succeeds and locks both actions while pending',
  async (action) => {
    const pending = createDeferred<unknown>()
    const request = deviceAction(action)
    request.mockReturnValueOnce(pending.promise)
    const { screen } = await renderDevicePage({ signedIn: true, url: landingUrl })
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
    await vi.waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith(withCode))
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

it('keeps the account and code available after failure and completes a native keyboard retry', async () => {
  deviceAction('approve').mockRejectedValueOnce(
    apiError({
      status: 400,
      code: 'unexpected',
      message: 'Unexpected',
      details: { error: 'unexpected' },
    }),
  )
  const { screen } = await renderDevicePage({ signedIn: true, url: landingUrl })
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await approve.click()
  await expect.element(screen.getByText('deviceFlow.approveError.default')).toBeVisible()
  await expect.element(approve).toBeEnabled()
  await expect.element(screen.getByText('gareth@example.com')).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('heading', { name: 'deviceFlow.success.title' }))
    .toBeVisible()
  expect(deviceAction('approve')).toHaveBeenLastCalledWith(withCode)
})

it('keeps focus on a pending action so a keyboard retry works after failure', async () => {
  const pending = createDeferred<unknown>()
  deviceAction('approve').mockReturnValueOnce(pending.promise)
  const { screen } = await renderDevicePage({ signedIn: true, url: landingUrl })
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await approve.click()
  await expect.element(approve).toHaveAttribute('aria-disabled', 'true')
  const button = await approve.element()
  expect(document.activeElement).toBe(button)
  // Reject only once the request reached the server, so the rejection always has a listener.
  await expect.poll(() => deviceAction('approve').mock.calls.length).toBe(1)
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
  expect(deviceAction('approve')).toHaveBeenCalledTimes(2)
})
