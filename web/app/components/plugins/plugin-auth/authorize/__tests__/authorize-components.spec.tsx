import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AuthCategory } from '../../types'
import AddApiKeyButton from '../add-api-key-button'
import AddOAuthButton from '../add-oauth-button'

const commands = vi.hoisted(() => ({
  add: vi.fn(),
  saveOAuth: vi.fn(),
  authorize: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('../../hooks/use-credential', () => ({
  useAddPluginCredentialHook: () => ({ mutateAsync: commands.add }),
  useUpdatePluginCredentialHook: () => ({ mutateAsync: vi.fn() }),
  useGetPluginCredentialSchemaHook: () => ({
    data: [{ name: 'api_key', label: 'API Key', type: FormTypeEnum.secretInput, required: true }],
    isLoading: false,
  }),
  useGetPluginOAuthClientSchemaHook: () => ({ data: {}, isLoading: false }),
  useGetPluginOAuthUrlHook: () => ({ mutateAsync: commands.authorize, isPending: false }),
  useSetPluginOAuthCustomClientHook: () => ({ mutateAsync: commands.saveOAuth }),
  useDeletePluginOAuthCustomClientHook: () => ({ mutateAsync: vi.fn() }),
  useInvalidPluginOAuthClientSchemaHook: () => commands.invalidate,
}))
const payload = { category: AuthCategory.tool, provider: 'test-provider' }
beforeEach(() => {
  commands.add.mockResolvedValue({})
  commands.saveOAuth.mockResolvedValue({})
})

it('opens an API key form and closes it after creating a credential', async () => {
  const user = userEvent.setup()
  const onUpdate = vi.fn()
  render(<AddApiKeyButton pluginPayload={payload} onUpdate={onUpdate} />)
  await user.click(screen.getByRole('button', { name: 'Use Api Key' }))
  await user.type(await screen.findByLabelText(/API Key/), 'new-secret')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(commands.add).toHaveBeenCalledWith(
    expect.objectContaining({ credentials: { api_key: 'new-secret' } }),
  )
  expect(onUpdate).toHaveBeenCalledOnce()
})

it('opens settings for an unconfigured OAuth provider and saves the entered client', async () => {
  const user = userEvent.setup()
  render(
    <AddOAuthButton
      pluginPayload={payload}
      oAuthData={{
        schema: [
          {
            name: 'client_id',
            label: { en_US: 'Client ID', zh_Hans: '客户端 ID' },
            type: FormTypeEnum.textInput,
            required: true,
          },
        ],
      }}
    />,
  )
  await user.click(screen.getByRole('button', { name: /plugin.auth.common.configureClient/ }))
  await user.type(await screen.findByRole('textbox', { name: /Client ID/ }), 'client-123')
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveOnly' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(commands.saveOAuth).toHaveBeenCalledWith({
    client_params: { client_id: 'client-123' },
    enable_oauth_custom_client: true,
  })
  expect(commands.authorize).not.toHaveBeenCalled()
})

it('keeps a disabled API key action closed and allows cancellation once enabled', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <AddApiKeyButton pluginPayload={payload} buttonText="Add key" disabled />,
  )
  const button = screen.getByRole('button', { name: 'Add key' })
  expect(button).toBeDisabled()
  await user.click(button)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<AddApiKeyButton pluginPayload={payload} buttonText="Add key" />)
  await user.click(button)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(commands.add).not.toHaveBeenCalled()
})
