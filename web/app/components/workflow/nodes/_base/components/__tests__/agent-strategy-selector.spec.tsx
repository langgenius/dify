import type { ReactNode } from 'react'
import type { StrategyPluginDetail } from '@/app/components/plugins/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { AgentStrategySelector } from '../agent-strategy-selector'

const mocks = vi.hoisted(() => ({
  useSuspenseQuery: vi.fn(),
  useStrategyProviders: vi.fn(),
  useMarketplacePlugins: vi.fn(),
  useStrategyInfo: vi.fn(),
  refetchStrategyInfo: vi.fn(),
  queryPluginsWithDebounced: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: mocks.useSuspenseQuery,
}))

vi.mock('@/service/system-features', () => ({
  systemFeaturesQueryOptions: () => ({}),
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
  default: () => ({
    getIconUrl: (icon: string) => `https://example.com/${icon}`,
  }),
}))

vi.mock('@/app/components/base/search-input', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/block-selector/view-type-select', () => ({
  default: ({
    onChange,
  }: {
    viewType: string
    onChange: (value: string) => void
  }) => (
    <button type="button" onClick={() => onChange('grid')}>
      view-type
    </button>
  ),
  ViewType: {
    flat: 'flat',
    grid: 'grid',
  },
}))

vi.mock('@/app/components/workflow/block-selector/tools', () => ({
  default: ({
    tools,
    onSelect,
  }: {
    tools: Array<{
      id: string
      name: string
      meta?: unknown
      tools: Array<{
        name: string
        label: string | { en_US?: string }
        output_schema?: Record<string, unknown>
      }>
    }>
    onSelect: (value: unknown, tool: {
      tool_name: string
      provider_name: string
      tool_label: string
      output_schema?: Record<string, unknown>
      provider_id: string
      meta?: unknown
    }) => void
  }) => (
    <div data-testid="tools-list">
      {tools.map(tool => (
        <div key={tool.id}>
          <span>{tool.name}</span>
          <button
            type="button"
            onClick={() => onSelect(undefined, {
              tool_name: tool.tools[0]!.name,
              provider_name: tool.id,
              tool_label: typeof tool.tools[0]!.label === 'string'
                ? tool.tools[0]!.label
                : tool.tools[0]!.label.en_US || '',
              output_schema: tool.tools[0]!.output_schema,
              provider_id: tool.id,
              meta: tool.meta,
            })}
          >
            {`select-${tool.name}`}
          </button>
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/block-selector/market-place-plugin/list', () => ({
  default: ({
    list,
    searchText,
  }: {
    list: Array<{ plugin_id: string }>
    searchText: string
  }) => (
    <div data-testid="plugin-list">
      {`${searchText}:${list.map(item => item.plugin_id).join(',')}`}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: ({
    onClick,
  }: {
    onClick?: (event: { stopPropagation: () => void }) => void
    uniqueIdentifier: string
    size: string
  }) => (
    <button
      type="button"
      data-testid="install-plugin-button"
      onClick={() => onClick?.({ stopPropagation: vi.fn() })}
    >
      install-plugin
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/switch-plugin-version', () => ({
  SwitchPluginVersion: ({
    onChange,
  }: {
    onChange: () => void
    uniqueIdentifier: string
    tooltip: ReactNode
  }) => (
    <button
      type="button"
      data-testid="switch-plugin-version"
      onClick={onChange}
    >
      switch-plugin-version
    </button>
  ),
}))

vi.mock('@/next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: ReactNode
    className?: string
  }) => <a href={href} className={className}>{children}</a>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@langgenius/dify-ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  })

  const Popover = ({
    children,
    open: controlledOpen,
    onOpenChange,
  }: {
    children: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? !!controlledOpen : uncontrolledOpen
    const setOpen = (nextOpen: boolean) => {
      if (!isControlled)
        setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    }

    return (
      <PopoverContext.Provider value={{ open, setOpen }}>
        {children}
      </PopoverContext.Provider>
    )
  }

  const PopoverTrigger = ({ render }: { render: React.ReactNode }) => {
    const { open, setOpen } = React.useContext(PopoverContext)
    return (
      <div data-testid="agent-strategy-trigger" onClick={() => setOpen(!open)}>
        {render}
      </div>
    )
  }

  const PopoverContent = ({ children }: { children: React.ReactNode }) => {
    const { open } = React.useContext(PopoverContext)
    return open ? <div data-testid="agent-strategy-popover">{children}</div> : null
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
  }
})

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <div>{render}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const createStrategyDetail = (
  name: string,
  strategyName: string,
  strategyLabel: string,
): StrategyPluginDetail => ({
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
    strategies: [{
      identity: {
        name: strategyName,
        author: 'Dify',
        label: { en_US: strategyLabel },
      },
      description: { en_US: `${strategyLabel} description` },
      parameters: [],
      output_schema: { result: { type: 'string' } },
    }],
  },
  meta: { version: '1.0.0' },
} as unknown as StrategyPluginDetail)

describe('AgentStrategySelector', () => {
  const alphaDetail = createStrategyDetail('alpha', 'alpha-strategy', 'Alpha Strategy')
  const betaDetail = createStrategyDetail('beta', 'beta-strategy', 'Beta Strategy')

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useSuspenseQuery.mockReturnValue({ data: true })
    mocks.useStrategyProviders.mockReturnValue({ data: [alphaDetail, betaDetail] })
    mocks.useMarketplacePlugins.mockReturnValue({
      queryPluginsWithDebounced: mocks.queryPluginsWithDebounced,
      plugins: [{ plugin_id: 'market-agent' }],
    })
    mocks.useStrategyInfo.mockReturnValue({
      strategyStatus: undefined,
      refetch: mocks.refetchStrategyInfo,
    })
  })

  it('filters strategies and queries marketplace when searching', async () => {
    const user = userEvent.setup()

    render(
      <AgentStrategySelector
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('agent-strategy-trigger'))

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-list')).toHaveTextContent(':market-agent')

    await user.type(
      screen.getByRole('textbox', { name: 'nodes.agent.strategy.searchPlaceholder' }),
      'alp',
    )

    await waitFor(() => {
      expect(mocks.queryPluginsWithDebounced).toHaveBeenLastCalledWith({
        query: 'alp',
        category: PluginCategoryEnum.agent,
      })
    })

    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).not.toBeInTheDocument()
  })

  it('maps the selected tool and closes the popover', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <AgentStrategySelector
        onChange={onChange}
      />,
    )

    await user.click(screen.getByTestId('agent-strategy-trigger'))
    await user.click(screen.getByRole('button', { name: 'select-alpha' }))

    expect(onChange).toHaveBeenCalledWith({
      agent_strategy_name: 'alpha-strategy',
      agent_strategy_provider_name: 'provider/alpha',
      agent_strategy_label: 'Alpha Strategy',
      agent_output_schema: { result: { type: 'string' } },
      plugin_unique_identifier: 'provider/alpha',
      meta: { version: '1.0.0' },
    })
    expect(screen.queryByTestId('agent-strategy-popover')).not.toBeInTheDocument()
  })

  it('renders the plugin-not-installed warning for external strategies', () => {
    mocks.useStrategyInfo.mockReturnValue({
      strategyStatus: {
        plugin: {
          source: 'external',
          installed: false,
        },
        isExistInPlugin: true,
      },
      refetch: mocks.refetchStrategyInfo,
    })

    render(
      <AgentStrategySelector
        value={{
          agent_strategy_provider_name: 'provider/alpha',
          agent_strategy_name: 'alpha-strategy',
          agent_strategy_label: 'Alpha Strategy',
          agent_output_schema: {},
          plugin_unique_identifier: 'provider/alpha',
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('nodes.agent.pluginNotInstalled')).toBeInTheDocument()
    expect(screen.getByText('nodes.agent.pluginNotInstalledDesc')).toBeInTheDocument()
  })

  it('renders install and switch-version actions for marketplace strategies', async () => {
    const user = userEvent.setup()

    mocks.useStrategyInfo.mockReturnValueOnce({
      strategyStatus: {
        plugin: {
          source: 'marketplace',
          installed: false,
        },
        isExistInPlugin: false,
      },
      refetch: mocks.refetchStrategyInfo,
    })

    const { rerender } = render(
      <AgentStrategySelector
        value={{
          agent_strategy_provider_name: 'provider/alpha',
          agent_strategy_name: 'alpha-strategy',
          agent_strategy_label: 'Alpha Strategy',
          agent_output_schema: {},
          plugin_unique_identifier: 'provider/alpha',
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('install-plugin-button')).toBeInTheDocument()

    mocks.useStrategyInfo.mockReturnValue({
      strategyStatus: {
        plugin: {
          source: 'marketplace',
          installed: true,
        },
        isExistInPlugin: false,
      },
      refetch: mocks.refetchStrategyInfo,
    })

    rerender(
      <AgentStrategySelector
        value={{
          agent_strategy_provider_name: 'provider/alpha',
          agent_strategy_name: 'alpha-strategy',
          agent_strategy_label: 'Alpha Strategy',
          agent_output_schema: {},
          plugin_unique_identifier: 'provider/alpha',
        }}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('switch-plugin-version'))

    expect(mocks.refetchStrategyInfo).toHaveBeenCalled()
  })
})
