import type { FormSchema } from '@/app/components/base/form/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ApiKeyDialog from '../api-key-dialog'

it('submits the real credential editor on Enter with its Save button in the dialog footer', async ({
  onTestFinished,
}) => {
  // The footer button belongs to AuthForm through `form`, but DOM user-event only
  // searches for submitters inside the form. Native input proves this editor path.
  onTestFinished(guardUnexpectedFetch())
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const schemas: FormSchema[] = [
    {
      name: 'provider_token',
      label: 'Provider token',
      type: FormTypeEnum.secretInput,
      required: true,
    },
  ]
  const onSave = vi.fn().mockResolvedValue(undefined)
  try {
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <ApiKeyDialog
          mode="add"
          open
          credentialSchemas={schemas}
          onSave={onSave}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    )
    const dialog = screen.getByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    await dialog.getByRole('textbox', { name: 'plugin.auth.authorizationName' }).fill('Research')
    const token = dialog.getByLabelText('Provider token')
    await token.fill('provider-secret')
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.save' }))
      .toBeEnabled()
    await token.click()
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => onSave.mock.calls)
      .toEqual([
        [
          {
            name: 'Research',
            credentials: { provider_token: 'provider-secret' },
          },
        ],
      ])
  } finally {
    queryClient.clear()
  }
})
