import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { ContactImBindingContent } from '../binding-dialog'
import { providerMetadata } from '../credentials'
import { ContactEmailConfigContent } from '../email-config-dialog'

it.each(['feishu', 'resend'] as const)(
  'keeps the %s credential draft until the closing content session unmounts',
  async (provider) => {
    const user = userEvent.setup()
    const client = new QueryClient()
    seedSystemFeatures(client)
    const close = vi.fn()
    const metadata = providerMetadata[provider]
    const definition = {
      provider,
      displayName: metadata.name,
      requiredFields: metadata.fields,
    }
    const content = (open: boolean) => (
      <QueryClientTestProvider queryClient={client}>
        <Dialog open={open}>
          <DialogContent>
            {provider === 'feishu' ? (
              <ContactImBindingContent
                integration={null}
                provider={definition}
                replaceActiveProvider={false}
                onOpenChange={close}
              />
            ) : (
              <ContactEmailConfigContent
                integration={null}
                provider={definition}
                onOpenChange={close}
              />
            )}
          </DialogContent>
        </Dialog>
      </QueryClientTestProvider>
    )
    const view = render(content(true))
    const label =
      provider === 'feishu'
        ? 'contacts.imPlatform.bindingDialog.field.secret'
        : 'contacts.imPlatform.email.apiKey'
    const input = await screen.findByLabelText(label)
    await user.type(input, 'unsaved-secret')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(close).toHaveBeenCalledWith(false)
    expect(input).toHaveValue('unsaved-secret')
    view.rerender(content(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    view.rerender(content(true))
    expect(await screen.findByLabelText(label)).toHaveValue('')
    client.clear()
  },
)
