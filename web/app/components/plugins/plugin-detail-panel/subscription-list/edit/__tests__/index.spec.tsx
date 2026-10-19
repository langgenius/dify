import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { EditModal } from '../index'

const requests = vi.hoisted(() => ({ update: vi.fn(), verify: vi.fn(), refetch: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.bySubscriptionId.subscriptions.update.post':
        requests.update,
      'workspaces.current.triggerProvider.byProvider.subscriptions.verify.bySubscriptionId.post':
        requests.verify,
    }),
  }
})
vi.mock('../../../store', () => ({
  usePluginStore: () => ({
    plugin_id: 'test/plugin',
    provider: 'provider-a',
    declaration: {
      trigger: {
        subscription_schema: [
          { name: 'channel', label: 'Channel', type: FormTypeEnum.textInput, required: true },
        ],
        subscription_constructor: {
          credentials_schema: [
            { name: 'api_key', label: 'API key', type: FormTypeEnum.secretInput, required: true },
          ],
          parameters: [
            { name: 'repo', label: 'Repository', type: FormTypeEnum.textInput, required: true },
          ],
        },
      },
    },
  }),
}))
vi.mock('../../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: requests.refetch }),
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const subscription: TriggerSubscription = {
  id: 'subscription-1',
  name: 'Original',
  provider: 'provider-a',
  credential_type: TriggerCredentialType.ApiKey,
  credentials: { api_key: '[__HIDDEN__]' },
  endpoint: 'https://example.com/callback',
  parameters: { repo: 'dify' },
  properties: { channel: 'releases' },
  workflows_in_use: 0,
}
const save = () => screen.getByRole('button', { name: 'common.operation.save' })
const subscriptionName = /pluginTrigger.modal.form.subscriptionName.label/
beforeEach(() => {
  requests.update.mockResolvedValue({})
  requests.verify.mockResolvedValue({ verified: true })
})

it.each([
  [TriggerCredentialType.Unauthorized, 'Channel', 'properties', 'channel'],
  [TriggerCredentialType.Oauth2, 'Repository', 'parameters', 'repo'],
] as const)(
  'validates and saves edited %s subscription fields',
  async (credentialType, label, payloadKey, field) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithConsoleQuery(
      <EditModal
        onClose={onClose}
        subscription={{ ...subscription, credential_type: credentialType }}
      />,
    )
    const name = screen.getByRole('textbox', { name: subscriptionName })
    await user.clear(name)
    await user.click(save())
    expect(requests.update).not.toHaveBeenCalled()
    await user.type(name, 'Renamed')
    const input = screen.getByRole('textbox', { name: new RegExp(label) })
    await user.clear(input)
    await user.type(input, 'updated')
    await user.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(requests.update).toHaveBeenCalledExactlyOnceWith({
      params: { subscription_id: 'subscription-1' },
      body: { name: 'Renamed', [payloadKey]: { [field]: 'updated' } },
    })
    expect(requests.refetch).toHaveBeenCalledOnce()
  },
)

it('verifies edited API credentials before saving them with the configuration', async () => {
  const user = userEvent.setup()
  const verification = createDeferred<{ verified: boolean }>()
  requests.verify.mockReturnValue(verification.promise)
  const onClose = vi.fn()
  renderWithConsoleQuery(<EditModal subscription={subscription} onClose={onClose} />)
  const key = screen.getByLabelText(/API key/)
  await user.clear(key)
  await user.type(key, 'new-secret')
  await user.click(screen.getByRole('button', { name: 'pluginTrigger.modal.common.verify' }))
  expect(
    await screen.findByRole('button', { name: 'pluginTrigger.modal.common.verifying' }),
  ).toBeDisabled()
  expect(requests.update).not.toHaveBeenCalled()
  expect(requests.verify).toHaveBeenCalledWith(
    {
      params: { provider: 'provider-a', subscription_id: 'subscription-1' },
      body: { credentials: { api_key: 'new-secret' } },
    },
    { context: { silent: true } },
  )
  verification.resolve({ verified: true })
  await screen.findByRole('textbox', { name: subscriptionName })
  await user.click(save())
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(requests.update).toHaveBeenCalledWith({
    params: { subscription_id: 'subscription-1' },
    body: { name: 'Original', parameters: undefined, credentials: { api_key: 'new-secret' } },
  })
})

it('preserves unchanged hidden credentials and leaves the dialog open if saving fails', async () => {
  const user = userEvent.setup()
  requests.update.mockRejectedValueOnce(new Error('Save failed'))
  const onClose = vi.fn()
  renderWithConsoleQuery(<EditModal subscription={subscription} onClose={onClose} />)
  await user.click(screen.getByRole('button', { name: 'pluginTrigger.modal.common.verify' }))
  await screen.findByRole('textbox', { name: subscriptionName })
  await user.click(save())
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Save failed'))
  expect(onClose).not.toHaveBeenCalled()
  expect(requests.update).toHaveBeenCalledWith({
    params: { subscription_id: 'subscription-1' },
    body: { name: 'Original', parameters: undefined, credentials: undefined },
  })
  await user.click(save())
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
})
