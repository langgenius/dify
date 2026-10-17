import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { CommonCreateModal } from '../common-modal'

const requests = vi.hoisted(() => ({
  create: vi.fn(),
  verify: vi.fn(),
  build: vi.fn(),
  update: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  const prefix = 'workspaces.current.triggerProvider.byProvider.subscriptions.builder'
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      [`${prefix}.create.post`]: requests.create,
      [`${prefix}.verifyAndUpdate.bySubscriptionBuilderId.post`]: requests.verify,
      [`${prefix}.build.bySubscriptionBuilderId.post`]: requests.build,
      [`${prefix}.update.bySubscriptionBuilderId.post`]: requests.update,
      [`${prefix}.logs.bySubscriptionBuilderId.get`]: async () => ({ logs: [] }),
    }),
  }
})
vi.mock('../../../store', () => ({
  usePluginStore: () => ({
    plugin_id: 'test/plugin',
    provider: 'provider-a',
    name: 'Plugin',
    declaration: {
      trigger: {
        subscription_schema: [
          { name: 'channel', label: 'Channel', type: FormTypeEnum.textInput, required: true },
        ],
        subscription_constructor: {
          credentials_schema: [
            { name: 'api_key', label: 'API key', type: FormTypeEnum.textInput, required: true },
          ],
          parameters: [
            { name: 'repo', label: 'Repository', type: FormTypeEnum.textInput, required: true },
          ],
        },
      },
    },
  }),
}))
// The list refresh is an external effect of completing this modal.
vi.mock('../../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: requests.refetch }),
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const builder: TriggerSubscriptionBuilder = {
  id: 'builder-1',
  provider: 'provider-a',
  name: '',
  credential_type: TriggerCredentialType.ApiKey,
  credentials: {},
  endpoint: 'https://example.com/callback',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
}
const verifyName = 'pluginTrigger.modal.common.verify'
const createName = 'pluginTrigger.modal.common.create'
const subscriptionName = /pluginTrigger.modal.form.subscriptionName.label/

beforeEach(() => {
  requests.create.mockResolvedValue({ subscription_builder: builder })
  requests.verify.mockResolvedValue({ verified: true })
  requests.build.mockResolvedValue({})
  requests.update.mockResolvedValue(builder)
})
afterEach(() => vi.useRealTimers())

it('initializes a builder, verifies entered credentials and submits validated configuration', async () => {
  const user = userEvent.setup()
  const verification = createDeferred<{ verified: boolean }>()
  requests.verify.mockReturnValue(verification.promise)
  const onClose = vi.fn()
  renderWithConsoleQuery(
    <CommonCreateModal createType={SupportedCreationMethods.APIKEY} onClose={onClose} />,
  )
  await waitFor(() =>
    expect(requests.create).toHaveBeenCalledWith({
      params: { provider: 'provider-a' },
      body: { credential_type: TriggerCredentialType.ApiKey },
    }),
  )
  await user.type(screen.getByRole('textbox', { name: /API key/ }), 'secret')
  await user.click(screen.getByRole('button', { name: verifyName }))
  expect(requests.verify).toHaveBeenCalledWith(
    {
      params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
      body: { credentials: { api_key: 'secret' } },
    },
    { context: { silent: true } },
  )
  expect(
    await screen.findByRole('button', { name: 'pluginTrigger.modal.common.verifying' }),
  ).toBeDisabled()
  expect(screen.queryByRole('textbox', { name: subscriptionName })).not.toBeInTheDocument()
  verification.resolve({ verified: true })
  await screen.findByRole('textbox', { name: subscriptionName })
  expect(
    screen.getByRole('textbox', { name: /pluginTrigger.modal.form.callbackUrl.label/ }),
  ).toHaveValue(builder.endpoint)
  await user.click(screen.getByRole('button', { name: createName }))
  expect(requests.build).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: subscriptionName }), 'Repo updates')
  await user.click(screen.getByRole('button', { name: createName }))
  expect(requests.build).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /Repository/ }), 'dify')
  await user.click(screen.getByRole('button', { name: createName }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(requests.build).toHaveBeenCalledExactlyOnceWith({
    params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
    body: { name: 'Repo updates', parameters: { repo: 'dify' } },
  })
  expect(requests.refetch).toHaveBeenCalledOnce()
})

it('shows a verification failure and lets the user correct credentials before continuing', async () => {
  const user = userEvent.setup()
  requests.verify.mockRejectedValueOnce(new Error('Credentials rejected'))
  renderWithConsoleQuery(
    <CommonCreateModal
      createType={SupportedCreationMethods.APIKEY}
      builder={builder}
      onClose={vi.fn()}
    />,
  )
  const input = screen.getByRole('textbox', { name: /API key/ })
  await user.type(input, 'wrong')
  await user.click(screen.getByRole('button', { name: verifyName }))
  expect(await screen.findByText('Credentials rejected')).toBeInTheDocument()
  await user.clear(input)
  await user.type(input, 'correct')
  await user.click(screen.getByRole('button', { name: verifyName }))
  await screen.findByRole('textbox', { name: subscriptionName })
  expect(requests.verify).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: { credentials: { api_key: 'correct' } } }),
    { context: { silent: true } },
  )
})

it('keeps configuration open after creation fails and permits retry', async () => {
  const user = userEvent.setup()
  requests.build.mockRejectedValueOnce(new Error('Build failed'))
  const onClose = vi.fn()
  renderWithConsoleQuery(
    <CommonCreateModal
      createType={SupportedCreationMethods.OAUTH}
      builder={builder}
      onClose={onClose}
    />,
  )
  await user.type(screen.getByRole('textbox', { name: subscriptionName }), 'Repo updates')
  await user.type(screen.getByRole('textbox', { name: /Repository/ }), 'dify')
  await user.click(screen.getByRole('button', { name: createName }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Build failed'))
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: createName }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
})

it('debounces manual property edits and validates them before creating the subscription', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  renderWithConsoleQuery(
    <CommonCreateModal
      createType={SupportedCreationMethods.MANUAL}
      builder={builder}
      onClose={onClose}
    />,
  )
  await user.type(screen.getByRole('textbox', { name: subscriptionName }), 'Manual updates')
  await user.click(screen.getByRole('button', { name: createName }))
  expect(requests.build).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /Channel/ }), 'release')
  expect(requests.update).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(requests.update).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
      body: { properties: { channel: 'release' } },
    }),
  )
  await user.click(screen.getByRole('button', { name: createName }))
  expect(requests.build).toHaveBeenCalledWith({
    params: { provider: 'provider-a', subscription_builder_id: 'builder-1' },
    body: { name: 'Manual updates' },
  })
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
})
