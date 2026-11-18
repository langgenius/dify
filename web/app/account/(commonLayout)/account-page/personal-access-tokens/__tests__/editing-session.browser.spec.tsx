import type { PersonalAccessTokenDetailResponse } from '@dify/contracts/api/console/account/types.gen'
import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { apiError, installFakeApi } from '@/test/fake-api'
import { renderTokenPage, token, tokenList } from './browser-test-env'

const api = {
  list: vi.fn<typeof consoleClient.account.personalAccessTokens.get>(),
  detail: vi.fn<typeof consoleClient.account.personalAccessTokens.byTokenId.get>(),
  update: vi.fn<typeof consoleClient.account.personalAccessTokens.byTokenId.patch>(),
  remove: vi.fn<(input: unknown) => Promise<void>>(),
}
vi.unmock('react-i18next')
const saved: PersonalAccessTokenDetailResponse = {
  token: { ...token, resource_scope_mode: 'all', workspace_scope_mode: 'all' },
  resources: [],
  workspaces: [],
}
beforeEach(async () => {
  await page.viewport(1100, 800)
  api.list.mockReset().mockResolvedValue(tokenList([token]))
  api.detail.mockReset().mockResolvedValue(saved)
  api.update.mockReset()
  api.remove.mockReset()
  onTestFinished(
    installFakeApi({
      console: {
        account: {
          personalAccessTokens: {
            get: (input) => api.list(input),
            byTokenId: {
              get: (input) => api.detail(input),
              patch: (input) => api.update(input),
              delete: (input) => api.remove(input),
            },
          },
        },
      },
    }),
  )
})

it('retains the edited name after validation failure and saves the loaded version without expiry', async () => {
  api.update
    .mockRejectedValueOnce(apiError('BAD_REQUEST', 400, 'Select at least one resource.'))
    .mockResolvedValue(saved)
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('renamed')
  await expect.element(dialog.getByRole('combobox')).not.toBeInTheDocument()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Select at least one resource.')
  await expect.element(name).toHaveValue('renamed')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { token_id: token.id },
      body: {
        name: 'renamed',
        version: 1,
        resource_scope: { mode: 'all', resources: [] },
        workspace_scope: { mode: 'all', workspace_ids: [] },
      },
    }),
  )
  await expect.element(screen.getByRole('button', { name: 'Edit', exact: true })).toHaveFocus()
})

it('returns to the edit trigger when cancelling during a background list refresh', async () => {
  const { screen, queryClient } = await renderTokenPage()
  const edit = screen.getByRole('button', { name: 'Edit', exact: true })
  await edit.click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toBeVisible()
  const refresh = createDeferred<ReturnType<typeof tokenList>>()
  api.list.mockReturnValueOnce(refresh.promise)
  const refetch = queryClient.invalidateQueries({
    queryKey: consoleQuery.account.personalAccessTokens.get.key(),
  })
  await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  await userEvent.keyboard('{Escape}')
  await expect.element(edit).toHaveFocus()
  refresh.resolve(tokenList([token]))
  await refetch
})

it('preserves a draft through a background refresh and reloads the new version only after a conflict', async () => {
  const latest = { ...saved, token: { ...saved.token, name: 'changed elsewhere', version: 2 } }
  api.update.mockImplementation(async ({ body }) => {
    if (body.version === 1) throw apiError('CONFLICT', 409, 'Token changed')
    return latest
  })
  const { screen, queryClient } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('my draft')
  api.detail.mockResolvedValue(latest)
  await queryClient.invalidateQueries({
    queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
      input: { params: { token_id: token.id } },
    }),
  })
  await expect.element(name).toHaveValue('my draft')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toMatchTextContent(/changed.*Reload/)
  await expect.element(name).toHaveValue('my draft')
  expect(api.update.mock.calls[0]![0].body.version).toBe(1)
  await dialog.getByRole('button', { name: 'Reload latest version', exact: true }).click()
  await expect.element(name).toHaveValue('changed elsewhere')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.update.mock.calls[1]![0].body.version).toBe(2)
})

it('keeps an expired editing draft readable and blocks further saving after the server confirms expiry', async () => {
  api.update.mockImplementation(async () => {
    api.detail.mockResolvedValue({ ...saved, token: { ...saved.token, status: 'expired' } })
    throw apiError('FORBIDDEN', 403, 'Token expired')
  })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('recoverable draft')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Expired')
  await expect.element(name).toHaveValue('recoverable draft')
})

it('keeps deletion open after failure and removes the row after retry', async () => {
  const pending = createDeferred()
  api.remove.mockReturnValueOnce(pending.promise).mockImplementation(async () => {
    api.list.mockResolvedValue(tokenList())
  })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true })
  await confirm.click()
  await expect.element(confirm).toBeDisabled()
  await expect.element(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
  await expect.element(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  pending.reject(apiError('INTERNAL_SERVER_ERROR', 500, 'Internal server error'))
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Action failed')
  await expect.element(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('row', { name: /release-pipeline/ }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})

it('clears the previous deletion error and returns focus to the current row on cancel', async () => {
  const other = { ...token, id: '019a0000-0000-7000-8000-000000000002', name: 'other-token' }
  api.list.mockResolvedValue(tokenList([token, other]))
  api.remove.mockRejectedValueOnce(apiError('INTERNAL_SERVER_ERROR', 500, 'Internal server error'))
  const { screen } = await renderTokenPage()
  const first = screen
    .getByRole('row', { name: /release-pipeline/ })
    .getByRole('button', { name: 'Delete' })
  const second = screen
    .getByRole('row', { name: /other-token/ })
    .getByRole('button', { name: 'Delete' })
  await first.click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect.element(first).toHaveFocus()
  await second.click()
  await expect.element(dialog.getByRole('heading')).toMatchTextContent(/other-token/)
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(second).toHaveFocus()
})

it('returns to Create token if a refresh removes the row while deletion is open', async () => {
  const { screen, queryClient } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  await expect.element(dialog).toBeVisible()
  api.list.mockResolvedValue(tokenList())
  await queryClient.invalidateQueries({
    queryKey: consoleQuery.account.personalAccessTokens.get.key(),
  })
  await expect.element(screen.getByText(token.name, { exact: true })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})
