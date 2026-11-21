import type { consoleClient } from '@/service/console'
import { QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import { ChangePasswordDialog } from '../change-password-dialog'

it('keeps native submit focus during password saving and supports retry without leaving the dialog', async () => {
  // Chromium proves native Enter submission and focus preservation when pending controls change.
  type Profile = Awaited<ReturnType<typeof consoleClient.account.password.post>>
  const retry = createDeferred<Profile>()
  const fake = installFakeApi({ console: { account: { password: { post: () => retry.promise } } } })
  onTestFinished(fake)
  const firstSave = hold(fake.console.account.password.post)
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ChangePasswordDialog isPasswordSet />
    </QueryClientProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'accountSettings.account.resetPassword' })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: 'accountSettings.account.resetPassword' })
  await dialog.getByLabelText('accountSettings.account.currentPassword').fill('Current123')
  await dialog.getByLabelText('accountSettings.account.newPassword').fill('NewPassword123')
  const confirmPassword = dialog.getByLabelText('accountSettings.account.confirmPassword')
  await confirmPassword.fill('NewPassword123')
  await userEvent.keyboard('{Enter}')

  const save = dialog.getByRole('button', { name: 'common.operation.reset' })
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirmPassword).toHaveFocus()
  await expect.element(confirmPassword).toHaveAttribute('readonly')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  await expect.element(confirmPassword).toHaveFocus()
  await vi.waitFor(() => expect(fake.console.account.password.post).toHaveBeenCalledOnce())

  firstSave.reject(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Password update failed' }),
  )
  await expect.element(save).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(confirmPassword).not.toHaveAttribute('readonly')
  await expect.element(confirmPassword).toHaveFocus()
  await expect.element(confirmPassword).toHaveValue('NewPassword123')
  await save.click()
  await expect.element(save).toHaveAttribute('aria-disabled', 'true')
  await expect.element(save).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  await expect.element(save).toHaveFocus()
  await vi.waitFor(() => expect(fake.console.account.password.post).toHaveBeenCalledTimes(2))

  retry.resolve({
    id: 'user-id',
    name: 'Alice',
    email: 'alice@example.com',
    avatar: '',
    avatar_url: null,
    is_password_set: true,
    timezone: 'UTC',
  })
  await expect.element(dialog).not.toBeInTheDocument()
})
