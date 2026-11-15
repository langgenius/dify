import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderTokenPage, token, tokenList } from './browser-test-env'

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.unmock('react-i18next')
// boundary: supply operation results while preserving generated options and real Query observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'account.personalAccessTokens.get': api.list,
      'account.personalAccessTokens.byTokenId.get': api.detail,
      'account.personalAccessTokens.byTokenId.patch': api.update,
      'account.personalAccessTokens.byTokenId.delete': api.remove,
    }),
  }
})
const saved = {
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
  onTestFinished(guardUnexpectedFetch())
})

it('retains the edited name after validation failure and saves the loaded version without expiry', async () => {
  api.update
    .mockRejectedValueOnce(new Error('Select at least one resource.'))
    .mockResolvedValue(token)
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
  expect(api.update).toHaveBeenLastCalledWith({
    params: { token_id: token.id },
    body: {
      name: 'renamed',
      version: 1,
      resource_scope: { mode: 'all', resources: [] },
      workspace_scope: { mode: 'all', workspace_ids: [] },
    },
  })
  await expect.element(screen.getByRole('button', { name: 'Edit', exact: true })).toHaveFocus()
})

it('preserves a draft through a background refresh and reloads the new version only after a conflict', async () => {
  const latest = { ...saved, token: { ...saved.token, name: 'changed elsewhere', version: 2 } }
  api.update.mockImplementation(async ({ body }) => {
    if (body.version === 1) throw new ORPCError('CONFLICT', { status: 409 })
    return latest.token
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
    throw new ORPCError('FORBIDDEN', { status: 403 })
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
  api.remove
    .mockRejectedValueOnce(new ORPCError('INTERNAL_SERVER_ERROR'))
    .mockImplementation(async () => {
      api.list.mockResolvedValue(tokenList())
    })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Action failed')
  await expect.element(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('row', { name: /release-pipeline/ }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})
