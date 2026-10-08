import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createTestQueryClient } from '@/test/query-client'
import { ChangePasswordDialog } from '../change-password-dialog'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@/service/base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  request: mocks.request,
  sseGeneratorPost: vi.fn(),
}))

function pendingResponse() {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((resolveResponse, rejectResponse) => {
    resolve = resolveResponse
    reject = rejectResponse
  })
  return { promise, resolve, reject }
}

it('keeps native submit focus during password saving and supports retry without leaving the dialog', async () => {
  // Chromium proves native Enter submission and focus preservation when pending controls change.
  const firstSave = pendingResponse()
  const retry = pendingResponse()
  mocks.request.mockReset()
  mocks.request.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(retry.promise)
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
  expect(mocks.request).toHaveBeenCalledOnce()

  firstSave.reject(new Error('Password update failed'))
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
  expect(mocks.request).toHaveBeenCalledTimes(2)

  retry.resolve(
    new Response(
      JSON.stringify({
        id: 'user-id',
        name: 'Alice',
        email: 'alice@example.com',
        avatar: '',
        avatar_url: null,
        is_password_set: true,
        timezone: 'UTC',
      } satisfies GetAccountProfileResponse),
      { headers: { 'content-type': 'application/json' } },
    ),
  )
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
