import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createProvider, createStrategy } from '../../../agent/__tests__/strategy-fixture'
import { AgentStrategySelector } from '../agent-strategy-selector'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: () => ({ queryPluginsWithDebounced: vi.fn(), plugins: [] }),
}))
vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByIds: () => ({
    isLoading: false,
    data: { data: { plugins: [] } },
    refetch: vi.fn(),
  }),
}))

beforeEach(() => vi.clearAllMocks())

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
