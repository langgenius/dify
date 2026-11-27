import type { WebAccountProfileResponse } from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { installFakeApi, route } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import Account from '../index'

// boundary: keeps account editing independent of global toast presentation.
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const initialProfile: WebAccountProfileResponse = {
  name: 'Joel',
  email: 'joel@example.com',
  avatar: null,
  avatar_url: null,
  is_password_set: false,
  interface_language: 'en-US',
  interface_theme: 'system',
  timezone: 'UTC',
}
const clients: ReturnType<typeof createTestQueryClient>[] = []

function mockAccount({ isPasswordSet = false, failPassword = false } = {}) {
  let profile = { ...initialProfile, is_password_set: isPasswordSet }
  const updateName = vi.fn(async (body: { name: string }) => {
    profile = { ...profile, name: body.name }
    return Response.json(profile)
  })
  const updatePassword = vi.fn(async (_request: Request): Promise<Response> => {
    if (failPassword) {
      return Response.json(
        { code: 'current_password_incorrect', message: 'Current password is incorrect.' },
        { status: 400 },
      )
    }
    profile = { ...profile, is_password_set: true }
    return Response.json(profile)
  })
  const getProfile = vi.fn(() => Response.json(profile))
  onTestFinished(
    installFakeApi({
      routes: [
        route('GET', 'public', '/system-features', () => ({
          ...createSystemFeaturesFixture(),
          enable_email_password_login: true,
        })),
        route('GET', 'public', '/account/profile', getProfile),
        route('PATCH', 'public', '/account/profile', ({ body }) =>
          updateName(body as { name: string }),
        ),
        route('POST', 'public', '/account/password', ({ request }) => updatePassword(request)),
      ],
    }),
  )
  return { getProfile, updateName, updatePassword }
}

async function showAccount() {
  const client = createTestQueryClient()
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <Account />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
})

it('saves the account name and refreshes the profile shown on the page', async () => {
  const requests = mockAccount()
  const screen = await showAccount()
  await expect.element(screen.getByText(initialProfile.email).first()).toBeVisible()
  await expect
    .element(screen.getByRole('heading', { name: 'accountSettings.account.langGeniusAccount' }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.editName' })
  await dialog.getByRole('textbox', { name: 'accountSettings.account.name' }).fill('Ada Lovelace')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('Ada Lovelace').first()).toBeVisible()
  expect(requests.updateName).toHaveBeenCalledOnce()
  expect(requests.updateName).toHaveBeenCalledWith({ name: 'Ada Lovelace' })
  expect(requests.getProfile).toHaveBeenCalledTimes(2)
})

it('validates names before saving and lets the user correct the linked field error', async () => {
  const requests = mockAccount()
  const screen = await showAccount()
  await screen.getByRole('button', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.editName' })
  const name = dialog.getByRole('textbox', { name: 'accountSettings.account.name' })
  const save = dialog.getByRole('button', { name: 'common.operation.save' })

  await name.fill('')
  await expect.element(save, { timeout: 1000 }).toBeEnabled()
  await save.click()
  await expect.element(name).toHaveAttribute('aria-invalid', 'true')
  await expect.element(name).toHaveAccessibleDescription('login.error.nameEmpty')
  expect(requests.updateName).not.toHaveBeenCalled()

  for (const invalidName of ['Al', 'a'.repeat(31), '🤖🤖']) {
    await name.fill(invalidName)
    await save.click()
    await expect.element(name).toHaveAttribute('aria-invalid', 'true')
    await expect
      .element(name)
      .toHaveAccessibleDescription('accountSettings.account.nameLengthInvalid:{"min":3,"max":30}')
    expect(requests.updateName).not.toHaveBeenCalled()
  }

  await name.fill(' A ')
  await expect.element(name).not.toHaveAttribute('aria-invalid', 'true')
  await save.click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(requests.updateName).toHaveBeenCalledExactlyOnceWith({ name: ' A ' })
})

it.each([
  { kind: 'three-character', name: 'Ada' },
  { kind: 'thirty-character', name: 'a'.repeat(30) },
  { kind: 'three-emoji', name: '🤖'.repeat(3) },
  { kind: 'thirty-emoji', name: '🤖'.repeat(30) },
])('saves a $kind name at the supported Unicode length boundary', async ({ name }) => {
  const requests = mockAccount()
  const screen = await showAccount()
  await screen.getByRole('button', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.editName' })
  await dialog.getByRole('textbox', { name: 'accountSettings.account.name' }).fill(name)
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(name, { exact: true }).first()).toBeVisible()
  expect(requests.updateName).toHaveBeenCalledExactlyOnceWith({ name })
})

it('sets a first password without a current password and updates the page to Reset password', async () => {
  const requests = mockAccount()
  const screen = await showAccount()
  await screen.getByRole('button', { name: 'accountSettings.account.setPassword' }).click()
  const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.setPassword' })
  await expect
    .element(dialog.getByLabelText('accountSettings.account.currentPassword'))
    .not.toBeInTheDocument()
  await dialog.getByLabelText('accountSettings.account.password').fill('newPassword123')
  await dialog.getByLabelText('accountSettings.account.confirmPassword').fill('newPassword123')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'accountSettings.account.resetPassword' }))
    .toBeVisible()
  expect(requests.updatePassword).toHaveBeenCalledOnce()
  expect(await requests.updatePassword.mock.calls[0]![0].clone().json()).toEqual({
    password: '',
    new_password: 'newPassword123',
    repeat_new_password: 'newPassword123',
  })
})

it('keeps a failed password reset open with its values and server error', async () => {
  const requests = mockAccount({ isPasswordSet: true, failPassword: true })
  const screen = await showAccount()
  await screen.getByRole('button', { name: 'accountSettings.account.resetPassword' }).click()
  const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.resetPassword' })
  await dialog.getByLabelText('accountSettings.account.currentPassword').fill('oldPassword123')
  await dialog.getByLabelText('accountSettings.account.newPassword').fill('newPassword123')
  await dialog.getByLabelText('accountSettings.account.confirmPassword').fill('newPassword123')
  await dialog.getByRole('button', { name: 'common.operation.reset' }).click()

  await expect.element(dialog.getByText('Current password is incorrect.')).toBeVisible()
  await expect
    .element(dialog.getByLabelText('accountSettings.account.currentPassword'))
    .toHaveAttribute('aria-invalid', 'true')
  await expect
    .element(dialog.getByLabelText('accountSettings.account.newPassword'))
    .toHaveValue('newPassword123')
  expect(requests.updatePassword).toHaveBeenCalledOnce()
  expect(await requests.updatePassword.mock.calls[0]![0].clone().json()).toEqual({
    password: 'oldPassword123',
    new_password: 'newPassword123',
    repeat_new_password: 'newPassword123',
  })
  expect(requests.getProfile).toHaveBeenCalledOnce()
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})
