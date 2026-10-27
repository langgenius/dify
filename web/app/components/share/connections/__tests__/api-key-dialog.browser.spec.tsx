import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ApiKeyDialog from '../api-key-dialog'

it('submits the real credential editor on Enter with its Save button in the dialog footer', async ({
  onTestFinished,
}) => {
  // Native Enter must reach the real form even when Save is in the dialog footer.
  onTestFinished(guardUnexpectedFetch())
  const onSave = vi.fn().mockResolvedValue(undefined)
  const screen = await render(
    <ApiKeyDialog mode="add" open onSave={onSave} onOpenChange={vi.fn()} />,
  )
  const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
  await dialog.getByRole('textbox', { name: 'plugin.auth.authorizationName' }).fill('Research')
  const token = dialog.getByLabelText(/share\.connections\.setup\.apiKey/)
  await token.fill('provider-secret')
  await expect.element(dialog.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
  await token.click()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => onSave.mock.calls)
    .toEqual([
      [
        {
          name: 'Research',
          credentials: { api_key: 'provider-secret' },
        },
      ],
    ])
})
