import copy from 'copy-to-clipboard'
import { installFakeApi } from '@/test/fake-api'
import { renderTokenPage, token, tokenList } from './browser-test-env'

vi.unmock('react-i18next')
// boundary: clipboard denial is an external failure; the real form owns retry feedback.
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
it('keeps the one-time secret available after clipboard denial and clears the error after retry', async () => {
  onTestFinished(
    installFakeApi({
      console: {
        account: {
          personalAccessTokens: {
            get: () => tokenList(),
            post: () => ({ ...token, secret: 'dpat_copy_retry' }),
          },
        },
      },
    }),
  )
  vi.mocked(copy).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const { screen } = await renderTokenPage()
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).fill('copy retry')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect.element(dialog.getByRole('alert')).toMatchTextContent(/copy/i)
  await expect
    .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
    .toHaveValue('dpat_copy_retry')
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect.element(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument()
})
