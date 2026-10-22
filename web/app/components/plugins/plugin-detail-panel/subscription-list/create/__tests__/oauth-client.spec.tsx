import type { ParametersSchema } from '@/app/components/plugins/types'
import type {
  TriggerOAuthConfig,
  TriggerSubscriptionBuilder,
} from '@/app/components/workflow/block-selector/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { toast } from '@/app/notifications'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { OAuthClientSettingsModal } from '../oauth-client'

const requests = vi.hoisted(() => ({
  configure: vi.fn(),
  authorize: vi.fn(),
  verify: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  const prefix = 'workspaces.current.triggerProvider.byProvider'
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      [`${prefix}.oauth.client.post`]: requests.configure,
      [`${prefix}.oauth.client.delete`]: requests.remove,
      [`${prefix}.subscriptions.oauth.authorize.get`]: requests.authorize,
      [`${prefix}.subscriptions.builder.verifyAndUpdate.bySubscriptionBuilderId.post`]:
        requests.verify,
    }),
  }
})
vi.mock('../../../store', () => ({ usePluginStore: () => ({ provider: 'provider-a' }) }))
vi.mock('@/hooks/use-oauth', () => ({ openOAuthPopup: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const field = (name: string, label: string, type: FormTypeEnum): ParametersSchema => ({
  name,
  label: { 'en-US': label, en_US: label } as ParametersSchema['label'],
  type,
  required: true,
  multiple: false,
  description: {} as ParametersSchema['description'],
  auto_generate: null,
  template: null,
  scope: null,
  min: null,
  max: null,
  precision: null,
})
const config: TriggerOAuthConfig = {
  configured: true,
  custom_configured: true,
  custom_enabled: true,
  system_configured: false,
  redirect_uri: 'https://example.com/oauth/callback',
  params: { client_id: 'existing-id', client_secret: 'existing-secret' },
  oauth_client_schema: [
    field('client_id', 'Client ID', FormTypeEnum.textInput),
    field('client_secret', 'Client Secret', FormTypeEnum.secretInput),
  ],
}
const builder: TriggerSubscriptionBuilder = {
  id: 'builder-1',
  provider: 'provider-a',
  name: '',
  credential_type: TriggerCredentialType.Oauth2,
  credentials: {},
  endpoint: 'https://example.com/callback',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
}
const renderModal = (oauthConfig = config) => {
  const onOpenChange = vi.fn()
  const showOAuthCreateModal = vi.fn()
  const view = renderWithConsoleQuery(
    <OAuthClientSettingsModal
      open
      oauthConfig={oauthConfig}
      onOpenChange={onOpenChange}
      showOAuthCreateModal={showOAuthCreateModal}
    />,
  )
  return { ...view, onOpenChange, showOAuthCreateModal }
}
const mockWriteText = vi.fn()
beforeEach(() => {
  mockWriteText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
  requests.configure.mockResolvedValue({})
  requests.authorize.mockResolvedValue({
    authorization_url: 'https://example.com/authorize',
    subscription_builder: builder,
  })
  requests.verify.mockResolvedValue({ verified: true })
  requests.remove.mockResolvedValue({})
})
afterEach(() => vi.useRealTimers())

it('validates custom client input and sends edited values while preserving unchanged secrets', async () => {
  const user = userEvent.setup()
  const { onOpenChange } = renderModal()
  const id = screen.getByRole('textbox', { name: /Client ID/ })
  expect(id).toHaveValue('existing-id')
  await user.clear(id)
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveOnly' }))
  expect(requests.configure).not.toHaveBeenCalled()
  await user.type(id, 'new-id')
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveOnly' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
  expect(requests.configure).toHaveBeenCalledExactlyOnceWith({
    params: { provider: 'provider-a' },
    body: { enabled: true, client_params: { client_id: 'new-id', client_secret: '[__HIDDEN__]' } },
  })
  expect(requests.authorize).not.toHaveBeenCalled()
})

it('uses the system client when selected and opens the authorization popup after saving', async () => {
  const user = userEvent.setup()
  const { onOpenChange, showOAuthCreateModal } = renderModal({ ...config, system_configured: true })
  expect(screen.queryByRole('textbox', { name: /Client ID/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  await waitFor(() =>
    expect(openOAuthPopup).toHaveBeenCalledWith(
      'https://example.com/authorize',
      expect.any(Function),
    ),
  )
  expect(requests.configure).toHaveBeenCalledWith({
    params: { provider: 'provider-a' },
    body: { enabled: false },
  })
  // This callback is the external OAuth window/message boundary, not a mutation callback.
  act(() => vi.mocked(openOAuthPopup).mock.calls[0]![1]({ type: 'oauth_callback', success: true }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(showOAuthCreateModal).toHaveBeenCalledWith(builder)
})

it('shows authorization failure and allows retry without closing the settings', async () => {
  const user = userEvent.setup()
  requests.authorize.mockRejectedValueOnce(new Error('Authorization failed'))
  const { onOpenChange } = renderModal()
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('pluginTrigger.modal.oauth.authorization.authFailed'),
  )
  expect(onOpenChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  await waitFor(() => expect(openOAuthPopup).toHaveBeenCalledOnce())
})

it('reports removal errors and closes only when the retry succeeds', async () => {
  const user = userEvent.setup()
  requests.remove.mockRejectedValueOnce(new Error('Removal denied'))
  const { onOpenChange } = renderModal()
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Removal denied'))
  expect(onOpenChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
  expect(requests.remove).toHaveBeenLastCalledWith({ params: { provider: 'provider-a' } })
})

it('continues authorization polling after errors and stops when verification succeeds', async () => {
  const user = userEvent.setup()
  // Only the polling interval is virtual; React Query and DOM scheduling stay real.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  requests.verify
    .mockRejectedValueOnce(new Error('Not ready'))
    .mockResolvedValueOnce({ verified: false })
    .mockResolvedValueOnce({ verified: true })
  const { unmount } = renderModal()
  await user.click(screen.getByRole('button', { name: 'plugin.auth.saveAndAuth' }))
  await waitFor(() => expect(openOAuthPopup).toHaveBeenCalledOnce())
  for (let i = 1; i <= 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await waitFor(() => expect(requests.verify).toHaveBeenCalledTimes(i))
  }
  expect(
    await screen.findByRole('button', {
      name: 'pluginTrigger.modal.oauth.authorization.waitingJump',
    }),
  ).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000)
  })
  expect(requests.verify).toHaveBeenCalledTimes(3)
  unmount()
})

it('copies the redirect URI and shows copied feedback on the button', async () => {
  const user = userEvent.setup()
  renderModal()
  await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
  expect(mockWriteText).toHaveBeenCalledWith('https://example.com/oauth/callback')
  expect(
    await screen.findByRole('button', { name: 'common.operation.copied' }),
  ).toBeInTheDocument()
  expect(toast.success).not.toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
})
