import type { ReactNode } from 'react'
import type { StrategyPluginDetail } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AgentStrategySelector } from '../agent-strategy-selector'

const mocks = vi.hoisted(() => ({
  useSuspenseQuery: vi.fn(),
  useStrategyProviders: vi.fn(),
  useMarketplacePlugins: vi.fn(),
  useStrategyInfo: vi.fn(),
  queryPluginsWithDebounced: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: mocks.useSuspenseQuery,
}))

vi.mock('@/service/use-strategy', () => ({
  useStrategyProviders: mocks.useStrategyProviders,
}))

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: mocks.useMarketplacePlugins,
}))

vi.mock('@/app/components/workflow/nodes/agent/use-config', () => ({
  useStrategyInfo: mocks.useStrategyInfo,
}))

vi.mock('@/app/components/plugins/install-plugin/base/use-get-icon', () => ({
  default: () => ({ getIconUrl: (icon: string) => `https://example.com/${icon}` }),
}))

vi.mock('@/app/components/base/search-input', () => ({
  SearchInput: ({ value, onValueChange, placeholder }: {
    value: string
    onValueChange: (value: string) => void
    placeholder?: string
  }) => (
    <input aria-label={placeholder} value={value} onChange={(e) => onValueChange(e.target.value)} />
  ),
}))

vi.mock('@/app/components/workflow/block-selector/view-type-select', () => ({
  default: () => <div />,
  ViewType: { flat: 'flat', grid: 'grid' },
}))

vi.mock('@/app/components/workflow/block-selector/tools', () => ({
  default: () => <div data-testid="tools-list" />,
}))

vi.mock('@/app/components/workflow/block-selector/marketplace-plugin/list', () => ({
  default: ({ list }: { list: Array<{ plugin_id: string }> }) => (
    <div data-testid="plugin-list">{list.map((plugin) => plugin.plugin_id).join(',')}</div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: () => <div />,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/switch-plugin-version', () => ({
  SwitchPluginVersion: () => <div />,
}))

vi.mock('@/next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const createStrategyDetail = (name: string): StrategyPluginDetail =>
  ({
    plugin_unique_identifier: `provider/${name}`,
    plugin_id: `plugin-${name}`,
    declaration: {
      identity: {
        author: 'Dify',
        name,
        description: { en_US: `${name} description` },
        icon: `${name}.png`,
        label: { en_US: `${name} label` },
        tags: [],
      },
      strategies: [
        {
          identity: { name: `${name}-strategy`, author: 'Dify', label: { en_US: `${name} Strategy` } },
          description: { en_US: `${name} strategy description` },
          parameters: [],
          output_schema: {},
        },
      ],
    },
    meta: { version: '1.0.0' },
  }) as unknown as StrategyPluginDetail

describe('AgentStrategySelector marketplace filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSuspenseQuery.mockReturnValue({ data: true })
    mocks.useStrategyProviders.mockReturnValue({ data: [createStrategyDetail('alpha')] })
    mocks.useMarketplacePlugins.mockReturnValue({
      queryPluginsWithDebounced: mocks.queryPluginsWithDebounced,
      plugins: [{ plugin_id: 'plugin-alpha' }, { plugin_id: 'market-agent' }],
    })
    mocks.useStrategyInfo.mockReturnValue({ strategyStatus: undefined, refetch: vi.fn() })
  })

  it('excludes installed strategy plugins from marketplace results', async () => {
    const user = userEvent.setup()
    render(<AgentStrategySelector onChange={vi.fn()} />)

    await user.click(
      screen
        .getByText(/(?:^|\.)nodes\.agent\.strategy\.selectTip(?=$|:)/)
        .closest('[aria-haspopup]')!,
    )

    expect(screen.getByTestId('plugin-list')).toHaveTextContent('market-agent')
    expect(screen.getByTestId('plugin-list')).not.toHaveTextContent('plugin-alpha')
  })
})
