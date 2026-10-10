import type {
  AgentApiAccessResponse,
  AgentAppDetailWithSite,
  ApiKeyItem,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ApiSecretKeyButton } from '@/app/components/app/access-point/shared/api-secret-key-button'
import { ServiceApi } from '@/app/components/datasets/extra-info/service-api'
import { AgentPermission } from '@/features/agent-v2/acl'
import { ServiceApiAccessCard } from '@/features/agent-v2/agent-detail/access/components/service-api-access-card'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAppDetailFixture } from '@/test/fixtures/app'

const { transport, datasetGet } = vi.hoisted(() => ({ transport: vi.fn(), datasetGet: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))

const title = 'appApi.apiKeyModal.apiSecretKey'
const createLabel = 'appApi.apiKeyModal.createNewSecretKey'
const closeLabel = 'common.operation.close'
const clients: QueryClient[] = []
const key: ApiKeyItem = { id: 'key-1', token: 'app-secret-browser-token', type: 'app' }
const apiAccess = {
  access_ready: true,
  enabled: true,
  api_key_count: 0,
  api_rph: 0,
  api_rpm: 0,
  service_api_base_url: 'https://api.example.com/v1',
  chat_endpoint: '',
  conversations_endpoint: '',
  files_upload_endpoint: '',
  info_endpoint: '',
  messages_endpoint: '',
  meta_endpoint: '',
  parameters_endpoint: '',
  stop_endpoint: '',
  streaming_only: false,
} satisfies AgentApiAccessResponse

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

async function renderOwner(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  })
  clients.push(client)
  seedAccountProfileQuery(client)
  seedCurrentWorkspaceQuery(client)
  seedWorkspacePermissionsQuery(client, ['dataset.api_key.manage'])
  seedSystemFeatures(client)
  const agent = {
    ...createAppDetailFixture({
      id: 'agent-1',
      permission_keys: [AgentPermission.AccessPointManage],
    }),
    deleted_tools: [],
    model_config: null,
    access_ready: true,
    debug_conversation_has_messages: false,
    debug_conversation_message_count: 0,
    hidden_app_backed: false,
  } satisfies AgentAppDetailWithSite
  client.setQueryData(
    consoleQuery.agent.byAgentId.get.queryOptions({ input: { params: { agent_id: 'agent-1' } } })
      .queryKey,
    agent,
  )
  client.setQueryData(
    consoleQuery.agent.byAgentId.apiAccess.get.queryOptions({
      input: { params: { agent_id: 'agent-1' } },
    }).queryKey,
    apiAccess,
  )
  return render(<QueryClientTestProvider queryClient={client}>{children}</QueryClientTestProvider>)
}

function requests(path: string) {
  return transport.mock.calls.filter(([parts]) => parts.join('.') === path)
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  transport.mockReset()
  transport.mockImplementation(async (parts: readonly string[]) => {
    const path = parts.join('.')
    if (path.endsWith('apiKeys.get')) return { data: [] }
    if (path === 'agent.byAgentId.apiAccess.get') return apiAccess
    throw new Error(`Unexpected Console request: ${path}`)
  })
  datasetGet.mockReset()
  datasetGet.mockResolvedValue({
    data: [{ id: 'dataset-1', name: 'Knowledge one' }],
    page: 1,
    has_more: false,
    limit: 20,
    total: 1,
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/datasets?')) throw new Error(`Unexpected fetch: ${url}`)
    return Response.json(await datasetGet(url))
  })
})

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each(['app', 'agent'] as const)(
  'keeps the %s manager pending, retries failure, and retains the result through exit before returning focus',
  async (kind) => {
    const pending = deferred<ApiKeyItem>()
    const createPath =
      kind === 'app' ? 'apps.byResourceId.apiKeys.post' : 'agent.byAgentId.apiKeys.post'
    const originalTransport = transport.getMockImplementation()!
    transport.mockImplementation((parts: readonly string[]) =>
      parts.join('.') === createPath
        ? requests(createPath).length === 1
          ? pending.promise
          : Promise.resolve(key)
        : originalTransport(parts),
    )
    const screen = await renderOwner(
      kind === 'app' ? (
        <ApiSecretKeyButton appId="app-1" canManage />
      ) : (
        <ServiceApiAccessCard agentId="agent-1" />
      ),
    )
    const entry = screen.getByRole('button', {
      name:
        kind === 'app'
          ? /appApi.apiKeyModal.apiSecretKey/
          : /agentV2.agentDetail.access.serviceApi.actions.apiKey/,
    })
    await entry.click()
    const manager = screen.getByRole('dialog', { name: title })
    const create = manager.getByRole('button', { name: createLabel })
    await create.click()
    await expect.element(create).toHaveFocus()
    await expect.element(manager.getByRole('button', { name: closeLabel })).toBeDisabled()
    await userEvent.keyboard('{Enter}{Escape}')
    await expect.element(manager).toBeVisible()
    expect(requests(createPath)).toHaveLength(1)
    pending.reject(new Error('Create failed'))
    await expect.element(create).not.toHaveAttribute('aria-disabled', 'true')
    await create.click()
    const result = screen.getByRole('dialog', { name: title }).last()
    await expect.element(result.getByText('appApi.apiKeyModal.generateTips')).toBeVisible()
    expect(requests(createPath)).toHaveLength(2)
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await result.getByRole('button', { name: 'common.operation.copy' }).click()
    await expect.poll(() => clipboard.mock.calls).toEqual([[key.token]])
    const popup = result.element()
    await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
    const exitValue = new Promise<boolean>((resolve) => {
      const onTransition = (event: Event) => {
        if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
        popup.removeEventListener('transitionrun', onTransition)
        const input = popup.querySelector<HTMLInputElement>('input')
        resolve(
          popup.isConnected &&
            (input ? input.value === key.token : popup.textContent?.includes(key.token) === true) &&
            popup.querySelector('[aria-label="common.operation.copied"]') !== null,
        )
      }
      popup.addEventListener('transitionrun', onTransition)
    })
    await result.getByRole('button', { name: 'appApi.actionMsg.ok' }).click()
    expect(await exitValue).toBe(true)
    await expect.poll(() => popup.isConnected).toBe(false)
    await expect.element(create).toHaveFocus()
    await manager.getByRole('button', { name: closeLabel }).click()
    await expect.element(manager).not.toBeInTheDocument()
    await expect.element(entry).toHaveFocus()
  },
)

it('resets cancelled dataset scope and hands creation back to the manager', async () => {
  const pending = deferred<ApiKeyItem>()
  const originalTransport = transport.getMockImplementation()!
  transport.mockImplementation((parts: readonly string[]) =>
    parts.join('.') === 'datasets.apiKeys.post' ? pending.promise : originalTransport(parts),
  )
  const screen = await renderOwner(<ServiceApi apiBaseUrl="https://api.example.com/v1" />)
  const entry = screen.getByRole('button', { name: 'dataset.serviceApi.title' })
  await entry.click()
  await screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }).click()
  const manager = screen.getByRole('dialog', { name: title })
  const create = manager.getByRole('button', { name: createLabel })
  await create.click()
  const scope = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' })
  expect(datasetGet).not.toHaveBeenCalled()
  await scope.getByRole('radio', { name: /^appApi.apiKeyModal.scopeSpecificDatasets / }).click()
  await scope.getByRole('combobox', { name: 'appApi.apiKeyModal.addKnowledgeBase' }).click()
  await screen.getByRole('option', { name: 'Knowledge one' }).click()
  expect(datasetGet).toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await scope.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(scope).not.toBeInTheDocument()
  await expect.element(create).toHaveFocus()
  await create.click()
  await expect
    .element(scope.getByRole('radio', { name: /^appApi.apiKeyModal.scopeAllDatasets / }))
    .toBeChecked()
  await scope.getByRole('radio', { name: /^appApi.apiKeyModal.scopeSpecificDatasets / }).click()
  await expect.element(scope.getByText('appApi.apiKeyModal.noKnowledgeBasesSelected')).toBeVisible()
  await scope.getByRole('radio', { name: /^appApi.apiKeyModal.scopeAllDatasets / }).click()
  await scope.getByRole('button', { name: 'common.operation.create' }).click()
  await expect.element(scope.getByRole('button', { name: closeLabel })).toBeDisabled()
  await userEvent.keyboard('{Enter}{Escape}')
  await expect.element(scope).toBeVisible()
  expect(requests('datasets.apiKeys.post')).toHaveLength(1)
  pending.resolve(key)
  await expect.element(scope).not.toBeInTheDocument()
  const result = screen.getByRole('dialog', { name: title }).last()
  await expect
    .element(result.getByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }))
    .toHaveValue(key.token)
  await result.getByRole('button', { name: 'appApi.actionMsg.ok' }).click()
  await expect
    .element(screen.getByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' }))
    .not.toBeInTheDocument()
  await expect.element(create).toHaveFocus()
  await manager.getByRole('button', { name: closeLabel }).click()
  await expect.element(manager).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
})

it.each(['app', 'agent'] as const)(
  'keeps the %s delete confirmation pending and returns focus inside the manager after its row is removed',
  async (kind) => {
    const pending = deferred<{ result: string }>()
    let existingKeys = [key]
    const listPath =
      kind === 'app' ? 'apps.byResourceId.apiKeys.get' : 'agent.byAgentId.apiKeys.get'
    const deletePath =
      kind === 'app'
        ? 'apps.byResourceId.apiKeys.byApiKeyId.delete'
        : 'agent.byAgentId.apiKeys.byApiKeyId.delete'
    transport.mockImplementation((parts: readonly string[]) => {
      const path = parts.join('.')
      if (path === listPath) return Promise.resolve({ data: existingKeys })
      if (path === deletePath) return pending.promise
      if (path === 'agent.byAgentId.apiAccess.get') return Promise.resolve(apiAccess)
      throw new Error(`Unexpected Console request: ${path}`)
    })
    const screen = await renderOwner(
      kind === 'app' ? (
        <ApiSecretKeyButton appId="app-1" canManage />
      ) : (
        <ServiceApiAccessCard agentId="agent-1" />
      ),
    )
    await screen
      .getByRole('button', {
        name:
          kind === 'app'
            ? /appApi.apiKeyModal.apiSecretKey/
            : /agentV2.agentDetail.access.serviceApi.actions.apiKey/,
      })
      .click()
    const manager = screen.getByRole('dialog', { name: title })
    const deleteButton = manager.getByRole('button', { name: /^common.operation.delete/ })
    await deleteButton.click()
    const confirmation = screen.getByRole('alertdialog')
    await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect.element(deleteButton).toHaveFocus()
    await deleteButton.click()
    const confirm = confirmation.getByRole('button', { name: 'common.operation.confirm' })
    await confirm.click()
    await expect.element(confirm).toHaveFocus()
    await expect
      .element(confirmation.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    await userEvent.keyboard('{Enter}{Escape}')
    await expect.element(confirmation).toBeVisible()
    expect(requests(deletePath)).toHaveLength(1)
    existingKeys = []
    pending.resolve({ result: 'success' })
    await expect.element(confirmation).not.toBeInTheDocument()
    await expect
      .element(manager.getByRole('button', { name: /^common.operation.delete/ }))
      .not.toBeInTheDocument()
    await expect.element(manager.getByRole('button', { name: createLabel })).toHaveFocus()
  },
)
