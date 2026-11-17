import { ORPCError } from '@orpc/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { testApiKeySchema } from '@/test/webapp-credential-schema'
import ApiKeyDialog from '../api-key-dialog'

it('submits on Enter through the external footer button and blocks a rejected key until it changes', async ({
  onTestFinished,
}) => {
  // Native Enter must reach the real form even when Save is in the dialog footer.
  onTestFinished(guardUnexpectedFetch())
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new ORPCError('connection_credentials_invalid', { status: 400 }))
    .mockResolvedValue(undefined)
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ApiKeyDialog
        serviceId="research"
        schemas={testApiKeySchema}
        mode="add"
        open
        onSave={onSave}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
  const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
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
          name: '',
          credentials: { api_key: 'provider-secret' },
        },
      ],
    ])
  await expect
    .element(dialog.getByRole('alert'))
    .toHaveTextContent('share.connections.apiKeys.validationError')
  await expect.element(dialog.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'plugin.auth.authorizationName' }).fill('Renamed')
  await userEvent.keyboard('{Enter}')
  expect(onSave).toHaveBeenCalledOnce()
  await token.fill('corrected-secret')
  await expect.element(dialog.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
  await token.click()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => onSave.mock.calls)
    .toEqual([
      [{ name: '', credentials: { api_key: 'provider-secret' } }],
      [{ name: 'Renamed', credentials: { api_key: 'corrected-secret' } }],
    ])
})
