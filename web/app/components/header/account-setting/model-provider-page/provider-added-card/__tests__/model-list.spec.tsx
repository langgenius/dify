import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { ConfigurationMethodEnum } from '../../declarations'
import {
  credentials,
  dialogName,
  provider,
  providerResponse,
  renderModelList,
  summaryProvider,
} from './model-list-test-env'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.workspaces.current.modelProviders.get>(),
  save: vi.fn<typeof consoleClient.workspaces.current.modelProviders.byProvider.models.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.get': api.detail,
      'workspaces.current.modelProviders.byProvider.models.credentials.get': async () =>
        structuredClone(credentials),
      'workspaces.current.modelProviders.byProvider.models.post': api.save,
    }),
  }
})
const configureButtons = () => screen.getAllByRole('button', { name: 'common.operation.config' })
beforeEach(() => {
  api.detail.mockReset().mockResolvedValue({ data: [providerResponse] })
  api.save.mockReset().mockResolvedValue({ result: 'success' })
})
afterEach(() => toast.dismiss())

it('lets the keyboard collapse the expanded model list', async () => {
  const { user, onCollapse } = renderModelList()
  await user.tab()
  expect(screen.getByRole('button', { name: /modelProvider.modelsNum/ })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onCollapse).toHaveBeenCalledOnce()
})

it('loads provider details for a summary card and prevents competing model selections until ready', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.detail>>>()
  api.detail.mockReturnValue(pending.promise)
  const { user } = renderModelList({ currentProvider: summaryProvider })
  const buttons = configureButtons()
  await user.click(buttons[0]!)
  await waitFor(() => expect(api.detail).toHaveBeenCalledOnce())
  expect(buttons).toHaveLength(2)
  expect(buttons[0]).toHaveAttribute('aria-disabled', 'true')
  expect(buttons[1]).toBeDisabled()
  await user.click(buttons[1]!)
  expect(api.detail).toHaveBeenCalledOnce()
  await act(async () => pending.resolve({ data: [providerResponse] }))
  expect(await screen.findByRole('button', { name: 'common.operation.save' })).toBeEnabled()
  expect(within(screen.getByRole('dialog', { name: dialogName })).getByText('gpt-4')).toBeVisible()
})

it.each(['missing provider', 'request failure'])(
  'reports %s without leaving controls disabled',
  async (failure) => {
    if (failure === 'missing provider') api.detail.mockResolvedValueOnce({ data: [] })
    else api.detail.mockRejectedValueOnce(new Error('offline'))
    const { user } = renderModelList({ currentProvider: summaryProvider })
    await user.click(configureButtons()[0]!)
    expect(await screen.findByText('common.api.actionFailed')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    expect(configureButtons()[0]).not.toHaveAttribute('aria-disabled', 'true')
    if (failure === 'request failure') {
      await user.click(configureButtons()[0]!)
      expect(await screen.findByRole('button', { name: 'common.operation.save' })).toBeEnabled()
    }
  },
)

it.each([
  {
    reason: 'missing permission',
    permissions: [],
    methods: [ConfigurationMethodEnum.customizableModel],
  },
  {
    reason: 'predefined models only',
    permissions: ['plugin.model_config'],
    methods: [ConfigurationMethodEnum.predefinedModel],
  },
  {
    reason: 'remote models only',
    permissions: ['plugin.model_config'],
    methods: [ConfigurationMethodEnum.fetchFromRemote],
  },
])('hides custom model actions for $reason', ({ permissions, methods }) => {
  renderModelList({ currentProvider: { ...provider, configurate_methods: methods }, permissions })
  expect(
    screen.queryByRole('button', { name: 'modelProvider.modelProvider.addModel' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'modelProvider.modelProvider.auth.manageCredentials' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('gpt-4')).toBeVisible()
})

it('offers Add Model without credential management when no custom models exist', () => {
  renderModelList({ permissions: ['plugin.model_config'] })
  expect(screen.getByRole('button', { name: 'modelProvider.modelProvider.addModel' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'modelProvider.modelProvider.auth.manageCredentials' }),
  ).not.toBeInTheDocument()
})

it('saves the selected model through the real dialog, notifies its owner and closes', async () => {
  const { user, onChange } = renderModelList()
  await user.click(configureButtons()[1]!)
  await user.click(await screen.findByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith(provider.provider))
  expect(api.save).toHaveBeenCalledExactlyOnceWith({
    params: { provider: provider.provider },
    body: {
      model: 'gpt-3.5',
      model_type: 'llm',
      config_from: 'predefined-model',
      credential_id: 'key-1',
      load_balancing: { enabled: false, configs: [] },
    },
  })
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
  )
})
