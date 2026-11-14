import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderTokenPage, token, tokenList } from './browser-test-env'

const api = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }))
vi.unmock('react-i18next')
// boundary: supply operation results while preserving generated options and real Query observers.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'account.personalAccessTokens.get': api.list,
      'account.personalAccessTokens.post': api.create,
    }),
  }
})

beforeEach(async () => {
  await page.viewport(1100, 800)
  api.list.mockReset().mockResolvedValue(tokenList())
  api.create.mockReset()
  onTestFinished(guardUnexpectedFetch())
})

it('clears the one-time secret and name after closing and reopening creation', async () => {
  api.create.mockResolvedValue({ ...token, secret: 'dpat_created_secret' })
  const { screen } = await renderTokenPage()
  const create = screen.getByRole('button', { name: 'Create token' })
  await create.click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('release')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const secret = dialog.getByRole('textbox', { name: 'Token', exact: true })
  await expect.element(secret).toHaveValue('dpat_created_secret')
  await expect.element(secret).toHaveAttribute('readonly')
  const docs = dialog.getByRole('link', { name: 'How to use it' })
  await expect
    .element(docs)
    .toHaveAttribute('href', expect.stringContaining('/api-reference/guides/get-started'))
  await expect.element(docs).toHaveAttribute('rel', 'noopener noreferrer')
  expect(api.create).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        name: 'release',
        expiration: '90_days',
        resource_scope: { mode: 'all', resources: [] },
        workspace_scope: { mode: 'none', workspace_ids: [] },
      },
    }),
  )
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(create).toHaveFocus()
  await create.click()
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('')
  await expect.element(secret).not.toBeInTheDocument()
})

it.each([
  ['a service message', 'Deployment catalog is unavailable.', 'Deployment catalog is unavailable.'],
  ['an empty error', '', 'Action failed'],
])('retains the draft after %s and completes a retry', async (_, message, feedback) => {
  api.create
    .mockRejectedValueOnce(new Error(message))
    .mockResolvedValue({ ...token, secret: 'dpat_retry' })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  const name = dialog.getByRole('textbox', { name: 'Name' })
  await name.fill('retained draft')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent(feedback)
  await expect.element(name).toHaveValue('retained draft')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect
    .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
    .toHaveValue('dpat_retry')
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
})

it('explains a successful idempotent response without a secret and offers no retry or retrieval', async () => {
  api.create.mockResolvedValue({ ...token, secret: null })
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('retry-safe')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toMatchTextContent(/secret/)
  await expect
    .element(dialog.getByRole('button', { name: 'Copy', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('button', { name: 'Retry', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
    .not.toBeInTheDocument()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(api.create).toHaveBeenCalledOnce()
})
