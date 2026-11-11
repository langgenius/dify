import type { WebAccountProfileResponse } from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createTestQueryClient } from '@/test/query-client'
import Account from '../index'

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: notifications }))

const currentEmail = 'joel@example.com'
const newEmail = 'ada@example.com'
const labels = {
  start: 'accountSettings.account.changeEmail.title',
  verifyOrigin: 'accountSettings.account.changeEmail.verifyEmail',
  newEmail: 'accountSettings.account.changeEmail.newEmail',
  verifyNew: 'accountSettings.account.changeEmail.verifyNew',
  send: 'accountSettings.account.changeEmail.sendVerifyCode',
  code: 'accountSettings.account.changeEmail.codeLabel',
  continue: 'accountSettings.account.changeEmail.continue',
}
const profile: WebAccountProfileResponse = {
  name: 'Joel',
  email: currentEmail,
  avatar: null,
  avatar_url: null,
  is_password_set: true,
  interface_language: 'en-US',
  interface_theme: 'system',
  timezone: 'UTC',
}
const clients: ReturnType<typeof createTestQueryClient>[] = []

function mockEmailApi() {
  let account = { ...profile }
  const requests: { request: Request; body: unknown }[] = []
  const send = vi.fn((body: { phase: string }) =>
    Response.json({
      result: 'success',
      data: body.phase === 'old_email' ? 'old-send-token' : 'new-send-token',
    }),
  )
  const verify = vi.fn((body: { email: string }) =>
    Response.json({
      email: body.email,
      is_valid: true,
      token: body.email === currentEmail ? 'old-verified' : 'new-verified',
    }),
  )
  const unique = vi.fn(() => Response.json({ result: 'success' }))
  const reset = vi.fn((body: { new_email: string }) => {
    account = { ...account, email: body.new_email }
    return Response.json(account)
  })
  const getProfile = vi.fn(() => Response.json(account))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const body = request.method === 'POST' ? await request.clone().json() : undefined
    requests.push({ request, body })
    if (path.endsWith('/system-features')) {
      return Response.json({ ...createSystemFeaturesFixture(), enable_change_email: true })
    }
    if (path.endsWith('/account/profile') && request.method === 'GET') return getProfile()
    if (path.endsWith('/account/change-email') && request.method === 'POST') return send(body)
    if (path.endsWith('/account/change-email/validity')) return verify(body)
    if (path.endsWith('/account/change-email/check-email-unique')) return unique()
    if (path.endsWith('/account/change-email/reset')) return reset(body)
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
  return { send, verify, unique, reset, getProfile, requests }
}

async function openEmailChange() {
  const client = createTestQueryClient()
  clients.push(client)
  const screen = await render(
    <QueryClientProvider client={client}>
      <Account />
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'common.operation.change' }).click()
  await expect.element(screen.getByRole('dialog', { name: labels.start })).toBeVisible()
  return screen
}

async function verifyOriginalEmail(screen: Awaited<ReturnType<typeof openEmailChange>>) {
  await screen
    .getByRole('dialog', { name: labels.start })
    .getByRole('button', { name: labels.send })
    .click()
  const dialog = screen.getByRole('dialog', { name: labels.verifyOrigin })
  await dialog.getByLabelText(labels.code).fill('123456')
  await dialog.getByRole('button', { name: labels.continue }).click()
  await expect.element(screen.getByRole('dialog', { name: labels.newEmail })).toBeVisible()
}

async function sendCodeToNewEmail(screen: Awaited<ReturnType<typeof openEmailChange>>) {
  await verifyOriginalEmail(screen)
  const addressDialog = screen.getByRole('dialog', { name: labels.newEmail })
  await addressDialog
    .getByLabelText('accountSettings.account.changeEmail.emailLabel')
    .fill(newEmail)
  await expect.element(addressDialog.getByRole('button', { name: labels.send })).toBeEnabled()
  await addressDialog.getByRole('button', { name: labels.send }).click()
  const verificationDialog = screen.getByRole('dialog', { name: labels.verifyNew })
  return verificationDialog
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

it('changes email through both verifications and refreshes the profile without logging out', async () => {
  const api = mockEmailApi()
  const screen = await openEmailChange()
  const verificationDialog = await sendCodeToNewEmail(screen)
  await verificationDialog.getByLabelText(labels.code).fill('654321')
  await verificationDialog
    .getByRole('button', {
      name: `accountSettings.account.changeEmail.changeTo:${JSON.stringify({ email: newEmail })}`,
    })
    .click()

  await expect.element(verificationDialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(newEmail).first()).toBeVisible()
  expect(api.getProfile).toHaveBeenCalledTimes(2)
  expect(
    api.requests
      .filter(({ request }) => request.method === 'POST')
      .map(({ request, body }) => ({
        path: new URL(request.url).pathname,
        body,
      })),
  ).toEqual([
    { path: '/api/account/change-email', body: { email: currentEmail, phase: 'old_email' } },
    {
      path: '/api/account/change-email/validity',
      body: { email: currentEmail, code: '123456', token: 'old-send-token' },
    },
    { path: '/api/account/change-email/check-email-unique', body: { email: newEmail } },
    {
      path: '/api/account/change-email',
      body: { email: newEmail, phase: 'new_email', token: 'old-verified' },
    },
    {
      path: '/api/account/change-email/validity',
      body: { email: newEmail, code: '654321', token: 'new-send-token' },
    },
    {
      path: '/api/account/change-email/reset',
      body: { new_email: newEmail, token: 'new-verified' },
    },
  ])
  for (const { request } of api.requests) {
    expect(request.credentials).toBe('include')
    expect(request.headers.has('x-app-code')).toBe(false)
    expect(request.headers.has('x-app-passport')).toBe(false)
    expect(new URL(request.url).pathname).not.toContain('logout')
  }
  expect(notifications.success).not.toHaveBeenCalled()
})

it('does not advance after sending fails and reopens a fresh change-email session', async () => {
  const api = mockEmailApi()
  api.send.mockReturnValueOnce(
    Response.json(
      { code: 'email_send_ip_limit', message: 'Please try again later.' },
      { status: 429 },
    ),
  )
  const screen = await openEmailChange()
  const start = screen.getByRole('dialog', { name: labels.start })
  await start.getByRole('button', { name: labels.send }).click()
  await expect.element(start.getByRole('alert')).toHaveTextContent('Please try again later.')
  await expect.element(start.getByRole('button', { name: labels.send })).toBeEnabled()
  await expect
    .element(screen.getByRole('dialog', { name: labels.verifyOrigin }))
    .not.toBeInTheDocument()
  expect(api.verify).not.toHaveBeenCalled()
  await start.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(start).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.change' }).click()
  await verifyOriginalEmail(screen)
  expect(api.send).toHaveBeenNthCalledWith(2, { email: currentEmail, phase: 'old_email' })
  await screen
    .getByRole('dialog', { name: labels.newEmail })
    .getByRole('button', { name: 'common.operation.cancel' })
    .click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.change' }).click()
  await screen
    .getByRole('dialog', { name: labels.start })
    .getByRole('button', { name: labels.send })
    .click()
  await expect.element(screen.getByRole('dialog', { name: labels.verifyOrigin })).toBeVisible()
  expect(api.send).toHaveBeenNthCalledWith(3, { email: currentEmail, phase: 'old_email' })
})

it('retries an invalid verification code in the same step using its send token', async () => {
  const api = mockEmailApi()
  api.verify.mockReturnValueOnce(
    Response.json(
      { code: 'email_code_error', message: 'Invalid verification code.' },
      { status: 400 },
    ),
  )
  const screen = await openEmailChange()
  await screen
    .getByRole('dialog', { name: labels.start })
    .getByRole('button', { name: labels.send })
    .click()
  const dialog = screen.getByRole('dialog', { name: labels.verifyOrigin })
  await dialog.getByLabelText(labels.code).fill('111111')
  await dialog.getByRole('button', { name: labels.continue }).click()
  await expect.element(dialog.getByText('Invalid verification code.')).toBeVisible()
  await expect.element(dialog.getByLabelText(labels.code)).toHaveAttribute('aria-invalid', 'true')
  await expect.element(dialog.getByRole('button', { name: labels.continue })).toBeEnabled()
  await expect.element(dialog).toBeVisible()
  await dialog.getByLabelText(labels.code).fill('123456')
  await dialog.getByRole('button', { name: labels.continue }).click()
  await expect.element(screen.getByRole('dialog', { name: labels.newEmail })).toBeVisible()
  expect(api.verify).toHaveBeenNthCalledWith(2, {
    email: currentEmail,
    code: '123456',
    token: 'old-send-token',
  })
  expect(api.reset).not.toHaveBeenCalled()
})

it('prevents sending a verification code to an already registered new email', async () => {
  const api = mockEmailApi()
  api.unique.mockReturnValue(
    Response.json(
      { code: 'email_already_in_use', message: 'Email is already registered.' },
      { status: 400 },
    ),
  )
  const screen = await openEmailChange()
  await verifyOriginalEmail(screen)
  const dialog = screen.getByRole('dialog', { name: labels.newEmail })
  await dialog.getByLabelText('accountSettings.account.changeEmail.emailLabel').fill(newEmail)
  await expect
    .element(dialog.getByText('accountSettings.account.changeEmail.existingEmail'))
    .toBeVisible()
  await expect.element(dialog.getByRole('button', { name: labels.send })).toBeDisabled()
  expect(api.send).toHaveBeenCalledOnce()
  expect(api.reset).not.toHaveBeenCalled()
})

it('keeps sending disabled when checking new-email uniqueness fails', async () => {
  const api = mockEmailApi()
  api.unique.mockReturnValue(
    Response.json(
      { code: 'internal_server_error', message: 'Email check unavailable.' },
      { status: 500 },
    ),
  )
  const screen = await openEmailChange()
  await verifyOriginalEmail(screen)
  const dialog = screen.getByRole('dialog', { name: labels.newEmail })
  await dialog.getByLabelText('accountSettings.account.changeEmail.emailLabel').fill(newEmail)
  await expect.element(dialog.getByText('Email check unavailable.')).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: labels.send })).toBeDisabled()
  expect(api.send).toHaveBeenCalledOnce()
  expect(api.reset).not.toHaveBeenCalled()
})

it('reuses the verified token when saving the new email fails and is retried', async () => {
  const api = mockEmailApi()
  api.reset.mockReturnValueOnce(
    Response.json(
      { code: 'internal_server_error', message: 'Email update unavailable.' },
      { status: 500 },
    ),
  )
  const screen = await openEmailChange()
  const dialog = await sendCodeToNewEmail(screen)
  const submit = dialog.getByRole('button', {
    name: `accountSettings.account.changeEmail.changeTo:${JSON.stringify({ email: newEmail })}`,
  })
  await dialog.getByLabelText(labels.code).fill('654321')
  await submit.click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Email update unavailable.')
  await expect.element(dialog.getByLabelText(labels.code)).toHaveValue('654321')
  expect(api.verify).toHaveBeenCalledTimes(2)
  expect(api.getProfile).toHaveBeenCalledOnce()

  await submit.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(newEmail).first()).toBeVisible()
  expect(api.verify).toHaveBeenCalledTimes(2)
  expect(api.reset).toHaveBeenNthCalledWith(1, { new_email: newEmail, token: 'new-verified' })
  expect(api.reset).toHaveBeenNthCalledWith(2, { new_email: newEmail, token: 'new-verified' })
})
