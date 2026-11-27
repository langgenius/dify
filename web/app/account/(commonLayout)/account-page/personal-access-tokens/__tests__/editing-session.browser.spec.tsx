import type {
  PersonalAccessTokenDetailResponse,
  PersonalAccessTokenResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { renderTokenPage, token, tokenList } from './browser-test-env'

vi.unmock('react-i18next')
const saved: PersonalAccessTokenDetailResponse = {
  token: { ...token, resource_scope_mode: 'all', workspace_scope_mode: 'all' },
  resources: [],
  workspaces: [],
}
// The server's token list, which a delete removes from.
let tokens: PersonalAccessTokenResponse[]

const fake = setupFakeApi(() => ({
  console: {
    account: {
      personalAccessTokens: {
        get: () => tokenList(tokens),
        byTokenId: {
          get: () => saved,
          patch: () => saved,
          delete: ({ params }) => {
            tokens = tokens.filter(({ id }) => id !== params.token_id)
          },
        },
      },
    },
  },
}))

beforeEach(async () => {
  await page.viewport(1100, 800)
  tokens = [token]
})

it('retains the edited name after validation failure and saves the loaded version without expiry', async () => {
  fake.console.account.personalAccessTokens.byTokenId.patch.mockRejectedValueOnce(
    apiError({ status: 400, code: 'BAD_REQUEST', message: 'Select at least one resource.' }),
  )
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
  expect(fake.console.account.personalAccessTokens.byTokenId.patch).toHaveBeenLastCalledWith(
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
  const refresh = hold(fake.console.account.personalAccessTokens.get)
  const refetch = queryClient.invalidateQueries({
    queryKey: consoleQuery.account.personalAccessTokens.get.key(),
  })
  await vi.waitFor(() =>
    expect(fake.console.account.personalAccessTokens.get).toHaveBeenCalledTimes(2),
  )
  await userEvent.keyboard('{Escape}')
  await expect.element(edit).toHaveFocus()
  refresh.resolve(tokenList([token]))
  await refetch
})

it('preserves a draft through a background refresh and reloads the new version only after a conflict', async () => {
  const latest = { ...saved, token: { ...saved.token, name: 'changed elsewhere', version: 2 } }
  fake.console.account.personalAccessTokens.byTokenId.patch.mockImplementation(async ({ body }) => {
    if (body.version === 1)
      throw apiError({ status: 409, code: 'CONFLICT', message: 'Token changed' })
    return latest
  })
  const { screen, queryClient } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = screen.getByRole('dialog')
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('my draft')
  fake.console.account.personalAccessTokens.byTokenId.get.mockResolvedValue(latest)
  await queryClient.invalidateQueries({
    queryKey: consoleQuery.account.personalAccessTokens.byTokenId.get.queryKey({
      input: { params: { token_id: token.id } },
    }),
  })
  await expect.element(name).toHaveValue('my draft')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toMatchTextContent(/changed.*Reload/)
  await expect.element(name).toHaveValue('my draft')
  expect(
    fake.console.account.personalAccessTokens.byTokenId.patch.mock.calls[0]![0].body.version,
  ).toBe(1)
  await dialog.getByRole('button', { name: 'Reload latest version', exact: true }).click()
  await expect.element(name).toHaveValue('changed elsewhere')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(
    fake.console.account.personalAccessTokens.byTokenId.patch.mock.calls[1]![0].body.version,
  ).toBe(2)
})

it('keeps an expired editing draft readable and blocks further saving after the server confirms expiry', async () => {
  fake.console.account.personalAccessTokens.byTokenId.patch.mockImplementation(async () => {
    fake.console.account.personalAccessTokens.byTokenId.get.mockResolvedValue({
      ...saved,
      token: { ...saved.token, status: 'expired' },
    })
    throw apiError({ status: 403, code: 'FORBIDDEN', message: 'Token expired' })
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
  const pending = hold(fake.console.account.personalAccessTokens.byTokenId.delete)
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
  pending.reject(
    apiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }),
  )
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
  tokens = [token, other]
  fake.console.account.personalAccessTokens.byTokenId.delete.mockRejectedValueOnce(
    apiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }),
  )
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
  tokens = []
  await queryClient.invalidateQueries({
    queryKey: consoleQuery.account.personalAccessTokens.get.key(),
  })
  await expect.element(screen.getByText(token.name, { exact: true })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})

it('reports that the saved token could not load', async () => {
  fake.console.account.personalAccessTokens.byTokenId.get.mockRejectedValue(
    apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Token storage unavailable' }),
  )
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect
    .element(screen.getByRole('dialog').getByRole('alert'))
    .toMatchTextContent(/Could not load access tokens/)
})
