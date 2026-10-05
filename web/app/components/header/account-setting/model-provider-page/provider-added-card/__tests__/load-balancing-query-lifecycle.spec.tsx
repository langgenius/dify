import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import ModelList from '../model-list'
import { credential, model, provider } from './load-balancing-fixtures'

const { get, moduleStarted, moduleLoaded, releaseModule, moduleReady } = vi.hoisted(() => {
  let releaseModule!: () => void
  const moduleReady = new Promise<void>((resolve) => {
    releaseModule = resolve
  })
  return { get: vi.fn(), moduleStarted: vi.fn(), moduleLoaded: vi.fn(), releaseModule, moduleReady }
})
vi.mock('@/service/base', () => ({
  get,
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}))
vi.mock('../model-load-balancing-modal', async (importOriginal) => {
  moduleStarted()
  await moduleReady
  const actual = await importOriginal<typeof import('../model-load-balancing-modal')>()
  moduleLoaded()
  return actual
})

it('loads detail before the module, preserves the import cache after dismissal, and releases only Popup credential subscriptions', async () => {
  let resolveDetail!: (value: { data: (typeof provider)[] }) => void
  const detail = new Promise<{ data: (typeof provider)[] }>((resolve) => {
    resolveDetail = resolve
  })
  const summary: ModelProviderSummaryResponse = {
    provider: provider.provider,
    plugin_id: 'test',
    label: provider.label,
    supported_model_types: ['llm'],
    configurate_methods: ['predefined-model'],
    preferred_provider_type: 'custom',
    is_configured: true,
    custom_configuration: {
      status: 'active',
      has_custom_models: false,
      available_credentials: [],
      current_credential_usable: true,
    },
    system_configuration: { enabled: false },
  }
  const credentialRequest = vi.fn(async () => structuredClone(credential))
  get.mockImplementation((path: string) => {
    if (path === '/workspaces/current/model-providers') return detail
    if (path.includes('/models/credentials?')) return credentialRequest()
    throw new Error(`Unexpected GET: ${path}`)
  })
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['plugin.model_config', 'credential.use'],
    systemFeatures: { rbac_enabled: true, deployment_edition: 'COMMUNITY' },
    features: { model_load_balancing_enabled: true },
  })
  const user = userEvent.setup()
  render(<ModelList provider={summary} models={[model]} onCollapse={vi.fn()} />, { wrapper })
  expect(get).not.toHaveBeenCalled()
  expect(moduleStarted).not.toHaveBeenCalled()
  const entry = screen.getByRole('button', { name: 'common.operation.config' })
  await user.click(entry)
  expect(entry).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(moduleStarted).not.toHaveBeenCalled()
  await act(async () => resolveDetail({ data: [provider] }))
  expect(await screen.findByRole('status')).toBeInTheDocument()
  expect(moduleStarted).toHaveBeenCalledOnce()
  expect(credentialRequest).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await act(async () => releaseModule())
  await waitFor(() => expect(moduleLoaded).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(credentialRequest).not.toHaveBeenCalled()

  await user.click(entry)
  await screen.findByRole('button', { name: 'common.operation.cancel' })
  expect(moduleStarted).toHaveBeenCalledOnce()
  expect(credentialRequest).toHaveBeenCalledOnce()
  await user.click(
    screen.getAllByRole('button', { name: 'modelProvider.modelProvider.loadBalancing' })[0]!,
  )
  expect(screen.getByRole('dialog')).toHaveAccessibleName(
    'modelProvider.modelProvider.auth.configLoadBalancing',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(async () => queryClient.invalidateQueries())
  expect(credentialRequest).toHaveBeenCalledOnce()
  expect(
    queryClient
      .getQueryCache()
      .find({ queryKey: commonQueryKeys.modelProviderDetails })
      ?.getObserversCount(),
  ).toBe(1)
  await user.click(entry)
  await screen.findByRole('button', { name: 'common.operation.cancel' })
  expect(credentialRequest).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('dialog')).toHaveAccessibleName(
    'modelProvider.modelProvider.auth.configModel',
  )
  queryClient.clear()
})
