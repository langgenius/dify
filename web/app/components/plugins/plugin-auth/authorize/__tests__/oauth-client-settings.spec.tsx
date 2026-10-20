import type { FormSchema } from '@/app/components/base/form/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { AuthCategory } from '../../types'
import OAuthClientSettings from '../oauth-client-settings'

const commands = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), invalidate: vi.fn() }))
vi.mock('../../hooks/use-credential', () => ({
  useSetPluginOAuthCustomClientHook: () => ({ mutateAsync: commands.save }),
  useDeletePluginOAuthCustomClientHook: () => ({ mutateAsync: commands.remove }),
  useInvalidPluginOAuthClientSchemaHook: () => commands.invalidate,
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn() } }))
const payload = { category: AuthCategory.tool, provider: 'test-provider' }
const schemas: FormSchema[] = [
  {
    name: '__oauth_client__',
    label: 'Client type',
    type: FormTypeEnum.textInput,
    default: 'custom',
    required: true,
  },
  { name: 'client_id', label: 'Client ID', type: FormTypeEnum.textInput, required: true },
]
beforeEach(() => {
  commands.save.mockResolvedValue({})
  commands.remove.mockResolvedValue({})
})

it('validates client fields and requests authorization only after a successful save', async () => {
  const user = userEvent.setup()
  const authorize = vi.fn()
  const onClose = vi.fn()
  render(
    <OAuthClientSettings
      pluginPayload={payload}
      schemas={schemas}
      onRequestAuthorization={authorize}
      onClose={onClose}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  expect(commands.save).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /Client ID/ }), 'new-client')
  commands.save.mockRejectedValueOnce(new Error('Save failed'))
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  await waitFor(() => expect(commands.save).toHaveBeenCalledOnce())
  expect(authorize).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  await waitFor(() => expect(authorize).toHaveBeenCalledOnce())
  expect(commands.save).toHaveBeenLastCalledWith({
    client_params: { client_id: 'new-client' },
    enable_oauth_custom_client: true,
  })
  expect(commands.invalidate).toHaveBeenCalledOnce()
})

it('prevents duplicate saves and supports removing the existing custom client', async () => {
  const user = userEvent.setup()
  const request = createDeferred<object>()
  commands.save.mockReturnValue(request.promise)
  const onUpdate = vi.fn()
  render(
    <OAuthClientSettings
      pluginPayload={payload}
      schemas={schemas}
      editValues={{ __oauth_client__: 'custom', client_id: 'saved-id' }}
      hasOriginalClientParams
      onUpdate={onUpdate}
    />,
  )
  await user.dblClick(screen.getByRole('button', { name: 'plugin.auth.saveOnly' }))
  expect(commands.save).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'common.operation.remove' })).toBeDisabled()
  request.resolve({})
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce())
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  await waitFor(() => expect(commands.remove).toHaveBeenCalledOnce())
  expect(onUpdate).toHaveBeenCalledTimes(2)
})

it('keeps the source popover open when typing in the OAuth settings dialog', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const onPopoverClose = vi.fn()
  const Harness = () => {
    const [open, setOpen] = useState(true)
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onPopoverClose()
        }}
      >
        <PopoverTrigger render={<button>OAuth</button>} />
        <PopoverContent>
          <OAuthClientSettings
            open={open}
            onOpenChange={setOpen}
            pluginPayload={payload}
            schemas={schemas}
            onClose={onClose}
          />
        </PopoverContent>
      </Popover>
    )
  }
  render(<Harness />)
  await user.type(await screen.findByRole('textbox', { name: /Client ID/ }), 'new-client')
  expect(onClose).not.toHaveBeenCalled()
  expect(onPopoverClose).not.toHaveBeenCalled()
})

it('shows custom redirect guidance after the client choice and before credential fields', async () => {
  const user = userEvent.setup()
  render(
    <OAuthClientSettings
      pluginPayload={payload}
      schemas={[
        {
          name: '__oauth_client__',
          label: 'Client type',
          type: FormTypeEnum.radio,
          required: false,
          default: 'default',
          options: [
            { label: 'System client', value: 'default' },
            { label: 'Custom client', value: 'custom' },
          ],
        },
        {
          name: 'client_id',
          label: 'Client ID',
          type: FormTypeEnum.textInput,
          required: true,
          show_on: [{ variable: '__oauth_client__', value: 'custom' }],
        },
      ]}
      redirectUri="https://redirect.example.test/callback"
    />,
  )
  expect(screen.queryByText('plugin.auth.customClientInfo')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /Client ID/ })).not.toBeInTheDocument()
  const customChoice = screen.getByRole('radio', { name: 'Custom client' })
  await user.click(customChoice)
  const guidance = screen.getByText('plugin.auth.customClientInfo')
  const clientId = screen.getByRole('textbox', { name: /Client ID/ })
  expect(guidance).toBeVisible()
  expect(screen.queryByText('plugin.auth.clientInfo')).not.toBeInTheDocument()
  expect(screen.getByText('https://redirect.example.test/callback')).toBeVisible()
  expect(
    customChoice.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(guidance.compareDocumentPosition(clientId) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: 'System client' }))
  expect(screen.queryByText('plugin.auth.customClientInfo')).not.toBeInTheDocument()
  expect(screen.queryByText('https://redirect.example.test/callback')).not.toBeInTheDocument()
})

it('preserves the required manual setup guidance when there is no system OAuth client', () => {
  render(
    <OAuthClientSettings
      pluginPayload={payload}
      schemas={schemas.filter((schema) => schema.name !== '__oauth_client__')}
      redirectUri="https://redirect.example.test/callback"
    />,
  )
  const guidance = screen.getByText('plugin.auth.clientInfo')
  expect(guidance).toBeVisible()
  expect(screen.queryByText('plugin.auth.customClientInfo')).not.toBeInTheDocument()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  const clientId = screen.getByRole('textbox', { name: /Client ID/ })
  expect(guidance.compareDocumentPosition(clientId) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
