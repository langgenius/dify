import type { AgentProviderResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { createPlugin } from '@/app/components/workflow/block-selector/__tests__/factories'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createProvider, createStrategy } from '../../../agent/__tests__/strategy-fixture'
import { AgentStrategySelector } from '../agent-strategy-selector'

const { request, searchMarketplace, marketplaceResults, marketplace, install } = vi.hoisted(() => ({
  request: vi.fn(),
  searchMarketplace: vi.fn(),
  marketplaceResults: vi.fn(),
  marketplace: vi.fn(),
  install: vi.fn(),
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: () => ({
    queryPluginsWithDebounced: searchMarketplace,
    plugins: marketplaceResults(),
  }),
}))
vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: marketplace,
  useCheckInstalled: () => ({ data: { plugins: [] }, isLoading: false, refetch: vi.fn() }),
  useInstallPackageFromMarketPlace: () => ({ mutate: install, isPending: false }),
}))

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({ canInstallPlugin: true, canUpdatePlugin: true }),
  }),
)

beforeEach(() => {
  vi.clearAllMocks()
  marketplaceResults.mockReturnValue([])
  marketplace.mockReturnValue({
    isLoading: false,
    data: { data: { plugins: [] } },
    refetch: vi.fn(),
  })
})

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

  await user.click(screen.getByText('workflow.nodes.agent.strategy.selectTip'))
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
  await user.click(screen.getByText('workflow.nodes.agent.strategy.selectTip'))
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
  await user.click(screen.getByText('workflow.nodes.agent.strategy.selectTip'))
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
  await user.click(screen.getByText('workflow.nodes.agent.strategy.selectTip'))
  await screen.findByRole('button', { name: 'Display name' })
  const search = screen.getByPlaceholderText('workflow.nodes.agent.strategy.searchPlaceholder')
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
  expect(searchMarketplace).not.toHaveBeenCalled()
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
  await user.click(screen.getByText('workflow.nodes.agent.strategy.selectTip'))
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
  marketplaceResults.mockReturnValue([
    createPlugin({ label: { en_US: 'Marketplace strategy', zh_Hans: 'Marketplace strategy' } }),
  ])
  request.mockImplementation(() => Promise.resolve(Response.json([createProvider()])))
  render(<AgentStrategySelector onChange={vi.fn()} />, {
    systemFeatures: { enable_marketplace: true },
  })
  await user.click(screen.getByText('workflow.nodes.agent.strategy.selectTip'))
  const link = screen.getByRole('link', { name: 'plugin.findMoreInMarketplace' })
  expect(link.getAttribute('href')).toContain('/plugins/agent-strategy')
  await user.type(
    screen.getByPlaceholderText('workflow.nodes.agent.strategy.searchPlaceholder'),
    'react',
  )
  expect(searchMarketplace).toHaveBeenLastCalledWith({
    query: 'react',
    category: PluginCategoryEnum.agent,
  })
  expect(screen.getByText('Marketplace strategy')).toBeInTheDocument()
})

it('preserves an older saved selection with no plugin identifier until the user chooses a replacement', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const provider = createProvider()
  request.mockImplementation((url: string) =>
    Promise.resolve(Response.json(url.includes('agent-providers') ? [provider] : provider)),
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

it('keeps the install action for a saved marketplace strategy that is no longer installed', async () => {
  const user = userEvent.setup()
  marketplace.mockReturnValue({
    isLoading: false,
    data: { data: { plugins: [createPlugin()] } },
    refetch: vi.fn(),
  })
  request.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('agent-providers')
        ? Response.json([])
        : Response.json({ message: 'Provider not installed' }, { status: 404 }),
    ),
  )
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
    { systemFeatures: { enable_marketplace: true } },
  )
  await user.click(
    await screen.findByRole('button', { name: 'workflow.nodes.agent.pluginInstaller.install' }),
  )
  expect(install).toHaveBeenCalledWith('langgenius/agent:1.0.0@hash', expect.any(Object))
  expect(
    screen.queryByPlaceholderText('workflow.nodes.agent.strategy.searchPlaceholder'),
  ).not.toBeInTheDocument()
  expect(screen.getByText('Saved label')).toBeInTheDocument()
})
