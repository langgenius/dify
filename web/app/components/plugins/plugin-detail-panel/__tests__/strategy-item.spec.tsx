import type {
  AgentProviderResponse,
  AgentStrategyEntity,
  AgentStrategyProviderIdentity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { normalizeInstalledPluginDetail } from '@/service/use-plugins'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AgentStrategyList from '../agent-strategy-list'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', () => ({ request }))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'zh-Hans',
}))

const provider: AgentStrategyProviderIdentity = {
  author: 'test-author',
  name: 'test-provider',
  description: { en_US: 'Provider description', zh_Hans: null },
  icon: 'icon.png',
  label: { en_US: 'Test Provider', zh_Hans: null },
  tags: null,
}

const strategy: AgentStrategyEntity = {
  identity: {
    author: 'author-1',
    name: 'strategy-1',
    label: { en_US: 'Strategy Label', zh_Hans: null },
    provider: 'provider-1',
  },
  description: { en_US: 'Strategy description', zh_Hans: null },
  parameters: [
    { name: 'query', type: 'string', label: { en_US: 'Query' }, help: { en_US: 'Search text' } },
  ],
}

const plugin = normalizeInstalledPluginDetail({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  source: 'marketplace',
  runtime_type: 'local',
  checksum: 'checksum',
  meta: {},
  declaration: {
    version: '1.0.0',
    author: 'Dify',
    name: 'Test Plugin',
    category: 'agent-strategy',
    created_at: '2024-01-01',
    icon: 'plugin.svg',
    label: { en_US: 'Test Plugin' },
    description: { en_US: 'Strategy plugin' },
    resource: {},
    plugins: {},
    meta: {},
    agent_strategy: { identity: provider },
  },
})

const createResponse = (): AgentProviderResponse => ({
  declaration: {
    identity: { ...provider, name: 'test-plugin/test-provider' },
    strategies: [
      { ...strategy, identity: { ...strategy.identity, provider: 'test-plugin/test-provider' } },
    ],
  },
  meta: {},
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  provider: 'test-provider',
})

beforeEach(() => {
  vi.clearAllMocks()
  request.mockImplementation(async () => Response.json(createResponse()))
})

describe('Plugin agent strategies', () => {
  it('loads the provider and opens and closes its real strategy drawer with localized fallback', async () => {
    const user = userEvent.setup()
    const requests: string[] = []
    request.mockImplementation(async (url: string) => {
      requests.push(decodeURIComponent(new URL(url).pathname))
      return Response.json(createResponse())
    })
    render(<AgentStrategyList detail={plugin} />)

    await user.click(await screen.findByText('Strategy Label'))
    const drawer = await screen.findByRole('dialog', { name: 'Strategy Label' })
    expect(within(drawer).getByText('Test Provider')).toBeInTheDocument()
    expect(within(drawer).getByText('Query')).toBeInTheDocument()
    expect(within(drawer).getByText('Search text')).toBeInTheDocument()
    expect(requests).toEqual([
      expect.stringMatching(/\/workspaces\/current\/agent-provider\/test-plugin\/test-provider$/),
    ])

    await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByText('Strategy Label'))
    await user.click(screen.getByText('BACK'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('allows an empty provider declaration without fabricating strategies', async () => {
    const response = createResponse()
    response.declaration.strategies = undefined
    request.mockImplementation(async () => Response.json(response))
    render(<AgentStrategyList detail={plugin} />)

    expect(
      await screen.findByText('plugin.detailPanel.strategyNum:{"num":0,"strategy":"strategy"}'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Strategy Label')).not.toBeInTheDocument()
  })

  it('does not request a provider when the plugin has no strategy declaration', () => {
    render(
      <AgentStrategyList
        detail={{ ...plugin, declaration: { ...plugin.declaration, agent_strategy: null } }}
      />,
    )

    expect(request).not.toHaveBeenCalled()
    expect(screen.queryByText(/plugin.detailPanel.strategyNum/)).not.toBeInTheDocument()
  })
})
