import type { AgentProviderResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { createPlugin } from '@/app/components/workflow/block-selector/__tests__/factories'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createInstalledPluginFixture } from '@/test/fixtures/plugin'
import { createProvider, createStrategy } from '../../../agent/__tests__/strategy-fixture'
import { AgentStrategySelector } from '../agent-strategy-selector'

const { request, marketplace, install, manifest } = vi.hoisted(() => ({
  request: vi.fn(),
  marketplace: vi.fn(),
  install: vi.fn(),
  manifest: vi.fn(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
  postMarketplace: marketplace,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': manifest,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.install.marketplace.post': install,
    }),
  }
})

beforeEach(() => {
  request.mockReset()
  marketplace.mockReset().mockResolvedValue({ data: { plugins: [], total: 0 } })
  manifest.mockReset().mockResolvedValue({ plugins: [] })
  install.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function searchUser() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}
async function finishSearch() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

function namedProvider(name: string, label: string, author: string): AgentProviderResponse {
  const provider = createProvider()
  return {
    ...provider,
    plugin_unique_identifier: `${name}:1.0.0@hash`,
    declaration: {
      ...provider.declaration,
      identity: {
        ...provider.declaration.identity,
        name,
        author,
        label: { en_US: label, zh_Hans: null },
      },
    },
  }
}

it('selects the generated strategy output and metadata through the real provider list', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const provider = createProvider([
    createStrategy({
      output_schema: { type: 'object', properties: { answer: { type: 'string' } } },
    }),
  ])
  request.mockImplementation(() => Promise.resolve(Response.json([provider])))
  render(<AgentStrategySelector onChange={onChange} />, {
    systemFeatures: { enable_marketplace: false },
  })

  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  await user.click(await screen.findByRole('button', { name: 'Agent provider' }))
  await user.click(await screen.findByRole('button', { name: 'ReAct' }))
  expect(onChange).toHaveBeenCalledWith({
    agent_strategy_name: 'react',
    agent_strategy_provider_name: 'langgenius/agent/provider',
    agent_strategy_label: 'ReAct',
    agent_output_schema: provider.declaration.strategies?.[0]?.output_schema,
    plugin_unique_identifier: 'langgenius/agent:1.0.0@hash',
    meta: { version: null },
  })
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'ReAct' })).not.toBeInTheDocument(),
  )
})

it('preserves a nullable output schema when selecting a strategy', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  request.mockImplementation(() => Promise.resolve(Response.json([createProvider()])))
  render(<AgentStrategySelector onChange={onChange} />, {
    systemFeatures: { enable_marketplace: false },
  })
  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  await user.click(await screen.findByRole('button', { name: 'Agent provider' }))
  await user.click(await screen.findByRole('button', { name: 'ReAct' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ agent_output_schema: null }))
})

it('preserves letter ordering and author groups across flat and tree views', async () => {
  const user = userEvent.setup()
  const providers = [
    namedProvider('zed', 'Zed', 'First author'),
    namedProvider('apple', 'Apple', 'Second author'),
    namedProvider('azure', 'Azure', 'First author'),
    namedProvider('apricot', 'Apricot', 'Second author'),
    namedProvider('symbol', '# Other', 'Third author'),
  ]
  request.mockImplementation(() => Promise.resolve(Response.json(providers)))
  render(<AgentStrategySelector onChange={vi.fn()} />, {
    systemFeatures: { enable_marketplace: false },
  })
  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  await screen.findByRole('button', { name: 'Apple' })
  const providerNames = () =>
    screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((name) => ['Zed', 'Apple', 'Azure', 'Apricot', '# Other'].includes(name ?? ''))
  expect(providerNames()).toEqual(['Apple', 'Apricot', 'Azure', 'Zed', '# Other'])
  await user.click(screen.getByRole('radio', { name: 'workflow.tabs.treeView' }))
  expect(screen.getByText('First author')).toBeInTheDocument()
  expect(screen.getByText('Second author')).toBeInTheDocument()
  expect(providerNames()).toEqual(['Zed', 'Azure', 'Apple', 'Apricot', '# Other'])
  await user.click(screen.getByRole('button', { name: 'Zed' }))
  expect(await screen.findByRole('button', { name: 'ReAct' })).toHaveAccessibleDescription(
    'Reason and use tools',
  )
})

it('filters by provider identity without changing the saved selection or opening strategy rows', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const providers = [
    namedProvider('org/target/provider', 'Display name', 'Author'),
    namedProvider('org/other/provider', 'Other', 'Author'),
  ]
  request.mockImplementation(() => Promise.resolve(Response.json(providers)))
  render(<AgentStrategySelector onChange={onChange} />, {
    systemFeatures: { enable_marketplace: false },
  })
  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  await screen.findByRole('button', { name: 'Display name' })
  const search = screen.getByPlaceholderText('workflowAgent.nodes.agent.strategy.searchPlaceholder')
  await user.type(search, 'TARGET')
  expect(screen.getByRole('button', { name: 'Display name' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
  await user.clear(search)
  await user.type(search, 'Display name')
  expect(screen.queryByRole('button', { name: 'Display name' })).not.toBeInTheDocument()
  expect(screen.getByText('tools.addToolModal.agent.title')).toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
  expect(marketplace).not.toHaveBeenCalled()
})

it('keeps letter navigation for long catalogs and removes it in tree view', async () => {
  const user = userEvent.setup()
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
  const providers = Array.from({ length: 11 }, (_, index) =>
    namedProvider(`provider-${index}`, `${String.fromCharCode(65 + index)} provider`, 'Author'),
  )
  request.mockImplementation(() => Promise.resolve(Response.json(providers)))
  render(<AgentStrategySelector onChange={vi.fn()} />, {
    systemFeatures: { enable_marketplace: false },
  })
  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  const letter = await screen.findByRole('button', { name: 'K' })
  await user.click(letter)
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth' })
  expect(scrollIntoView.mock.contexts[0]).toContainElement(
    screen.getByRole('button', { name: 'K provider' }),
  )
  scrollIntoView.mockRestore()
  await user.click(screen.getByRole('radio', { name: 'workflow.tabs.treeView' }))
  expect(screen.queryByRole('button', { name: 'K' })).not.toBeInTheDocument()
})

it('keeps marketplace search and its category link alongside the installed catalog', async () => {
  const user = userEvent.setup()
  marketplace.mockResolvedValue({
    data: {
      total: 2,
      plugins: [
        createPlugin({ label: { en_US: 'Marketplace strategy', zh_Hans: 'Marketplace strategy' } }),
      ],
    },
  })
  request.mockImplementation(() => Promise.resolve(Response.json([createProvider()])))
  render(<AgentStrategySelector onChange={vi.fn()} />, {
    systemFeatures: { enable_marketplace: true },
  })
  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  const link = screen.getByRole('link', { name: 'plugin.findMoreInMarketplace' })
  expect(new URL(link.getAttribute('href')!, window.location.href).pathname).toBe(
    '/plugins/agent-strategy',
  )
  await screen.findByRole('button', { name: 'Agent provider' })
  const search = searchUser()
  await search.type(
    screen.getByPlaceholderText('workflowAgent.nodes.agent.strategy.searchPlaceholder'),
    'react',
  )
  await finishSearch()
  expect(await screen.findByText('Marketplace strategy')).toBeInTheDocument()
  expect(marketplace).toHaveBeenCalledWith(
    '/plugins/search/advanced',
    expect.objectContaining({
      body: expect.objectContaining({ query: 'react', category: PluginCategoryEnum.agent }),
    }),
  )
})

it('shows installed strategies once and keeps other marketplace results available', async () => {
  const user = userEvent.setup()
  const provider = createProvider()
  marketplace.mockResolvedValue({
    data: {
      total: 2,
      plugins: [
        createPlugin({ plugin_id: provider.plugin_id, label: { en_US: 'Installed Marketplace' } }),
        createPlugin({ plugin_id: 'org/available', label: { en_US: 'Available Marketplace' } }),
      ],
    },
  })
  request.mockImplementation(() => Promise.resolve(Response.json([provider])))
  render(<AgentStrategySelector onChange={vi.fn()} />, {
    systemFeatures: { enable_marketplace: true },
  })

  await user.click(screen.getByText('workflowAgent.nodes.agent.strategy.selectTip'))
  expect(await screen.findByRole('button', { name: 'Agent provider' })).toBeInTheDocument()
  const search = searchUser()
  await search.type(
    screen.getByPlaceholderText('workflowAgent.nodes.agent.strategy.searchPlaceholder'),
    'agent',
  )
  await finishSearch()
  await screen.findByText('Available Marketplace')
  expect(screen.queryByText('Installed Marketplace')).not.toBeInTheDocument()
  expect(await screen.findByText('Available Marketplace')).toBeInTheDocument()
})

it('preserves an older saved selection with no plugin identifier until the user chooses a replacement', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const provider = createProvider()
  request.mockImplementation((url: string) =>
    Promise.resolve(Response.json(url.endsWith('/agent-providers') ? [provider] : provider)),
  )
  render(
    <AgentStrategySelector
      value={{
        agent_strategy_provider_name: provider.declaration.identity.name,
        agent_strategy_name: 'react',
        agent_strategy_label: 'Saved label',
        agent_output_schema: null,
      }}
      onChange={onChange}
    />,
    { systemFeatures: { enable_marketplace: false } },
  )
  expect(screen.getByText('Saved label')).toBeInTheDocument()
  await user.click(screen.getByText('Saved label'))
  await user.click(await screen.findByRole('button', { name: 'Agent provider' }))
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'ReAct' }))
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      plugin_unique_identifier: provider.plugin_unique_identifier,
      meta: { version: null },
      agent_output_schema: null,
    }),
  )
})

it('installs a missing saved strategy and refreshes its availability', async () => {
  const user = userEvent.setup()
  const installation = createDeferred<{ all_installed: boolean; task_id: string }>()
  marketplace.mockResolvedValue({ data: { plugins: [createPlugin()], total: 1 } })
  let installed = false
  const provider = createProvider()
  request.mockImplementation((url: string) => {
    if (url.endsWith('/agent-providers'))
      return Promise.resolve(Response.json(installed ? [provider] : []))
    if (installed) return Promise.resolve(Response.json(provider))
    return Promise.reject(new Error('Provider not installed'))
  })
  install.mockImplementation(async () => {
    const response = await installation.promise
    installed = true
    return response
  })
  manifest.mockImplementation(async () => ({
    plugins: installed
      ? [
          createInstalledPluginFixture({
            id: 'langgenius/agent:1.0.0@hash',
            plugin_id: 'langgenius/agent',
            plugin_unique_identifier: 'langgenius/agent:1.0.0@hash',
          }),
        ]
      : [],
  }))
  render(
    <AgentStrategySelector
      value={{
        agent_strategy_provider_name: 'langgenius/agent/provider',
        agent_strategy_name: 'react',
        agent_strategy_label: 'Saved label',
        agent_output_schema: null,
        plugin_unique_identifier: 'langgenius/agent:1.0.0@hash',
      }}
      onChange={vi.fn()}
    />,
    { systemFeatures: { enable_marketplace: true }, workspacePermissionKeys: ['plugin.install'] },
  )
  await user.click(
    await screen.findByRole('button', {
      name: 'workflowAgent.nodes.agent.pluginInstaller.install',
    }),
  )
  expect(
    await screen.findByRole('button', {
      name: 'workflowAgent.nodes.agent.pluginInstaller.installing',
    }),
  ).toBeDisabled()
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['langgenius/agent:1.0.0@hash'] },
  })
  await act(async () => installation.resolve({ all_installed: true, task_id: 'task-1' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /pluginInstaller.install/ }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Saved label')).toBeInTheDocument()
  expect(
    screen.queryByPlaceholderText('workflowAgent.nodes.agent.strategy.searchPlaceholder'),
  ).not.toBeInTheDocument()
})
