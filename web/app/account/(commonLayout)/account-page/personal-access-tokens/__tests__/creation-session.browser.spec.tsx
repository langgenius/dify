import { page, userEvent } from 'vite-plus/test/browser'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { renderTokenPage, token, tokenList } from './browser-test-env'

vi.unmock('react-i18next')

const fake = setupFakeApi(() => ({
  console: {
    account: {
      personalAccessTokens: {
        get: () => tokenList(),
        post: () => ({ ...token, secret: 'dpat_created_secret' }),
      },
    },
  },
}))

beforeEach(async () => {
  await page.viewport(1100, 800)
})

it('clears the one-time secret and name after closing and reopening creation', async () => {
  const pending = hold(fake.console.account.personalAccessTokens.post)
  const { screen } = await renderTokenPage()
  const create = screen.getByRole('button', { name: 'Create token' })
  await create.click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('release')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect.element(dialog.getByRole('textbox', { name: 'Name' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  pending.resolve({ ...token, secret: 'dpat_created_secret' })
  const secret = dialog.getByRole('textbox', { name: 'Token', exact: true })
  await expect.element(secret).toHaveValue('dpat_created_secret')
  await expect.element(secret).toHaveAttribute('readonly')
  const docs = dialog.getByRole('link', { name: 'How to use it' })
  await expect
    .element(docs)
    .toHaveAttribute('href', expect.stringContaining('/cli/personal-access-tokens'))
  await expect.element(docs).toHaveAttribute('rel', 'noopener noreferrer')
  expect(fake.console.account.personalAccessTokens.post).toHaveBeenCalledWith(
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

it('retains the draft after a service message and completes a retry', async () => {
  const feedback = 'Deployment catalog is unavailable.'
  fake.console.account.personalAccessTokens.post
    .mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: feedback }),
    )
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
  fake.console.account.personalAccessTokens.post.mockResolvedValue({ ...token, secret: null })
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
  expect(fake.console.account.personalAccessTokens.post).toHaveBeenCalledOnce()
})
