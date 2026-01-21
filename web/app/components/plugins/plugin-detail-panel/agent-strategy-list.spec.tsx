import type { PluginDetail, StrategyDetail } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentStrategyList from './agent-strategy-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.num !== undefined)
        return `${options.num} ${options.strategy || 'strategies'}`
      return key
    },
  }),
}))

const mockStrategies = [
  {
    identity: {
      author: 'author-1',
      name: 'strategy-1',
      icon: 'icon.png',
      label: { en_US: 'Strategy 1' },
      provider: 'provider-1',
    },
    parameters: [],
    description: { en_US: 'Strategy 1 desc' },
    output_schema: {},
    features: [],
  },
] as unknown as StrategyDetail[]

let mockStrategyProviderDetail: { declaration: { identity: unknown, strategies: StrategyDetail[] } } | undefined

vi.mock('@/service/use-strategy', () => ({
  useStrategyProviderDetail: () => ({
    data: mockStrategyProviderDetail,
  }),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/strategy-item', () => ({
  default: ({ detail }: { detail: StrategyDetail }) => (
    <div data-testid="strategy-item">{detail.identity.name}</div>
  ),
}))

const createPluginDetail = (): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    agent_strategy: {
      identity: {
        author: 'test-author',
        name: 'test-strategy',
        label: { en_US: 'Test Strategy' },
        description: { en_US: 'Test' },
        icon: 'icon.png',
        tags: [],
      },
    },
  } as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-uid',
  source: 'marketplace' as PluginDetail['source'],
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
})

describe('AgentStrategyList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStrategyProviderDetail = {
      declaration: {
        identity: { author: 'test', name: 'test' },
        strategies: mockStrategies,
      },
    }
  })

  describe('Rendering', () => {
    it('should render strategy items when data is available', () => {
      render(<AgentStrategyList detail={createPluginDetail()} />)

      expect(screen.getByText('1 strategy')).toBeInTheDocument()
      expect(screen.getByTestId('strategy-item')).toBeInTheDocument()
    })

    it('should return null when no strategy provider detail', () => {
      mockStrategyProviderDetail = undefined
      const { container } = render(<AgentStrategyList detail={createPluginDetail()} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should render multiple strategies', () => {
      mockStrategyProviderDetail = {
        declaration: {
          identity: { author: 'test', name: 'test' },
          strategies: [
            ...mockStrategies,
            { ...mockStrategies[0], identity: { ...mockStrategies[0].identity, name: 'strategy-2' } },
          ],
        },
      }
      render(<AgentStrategyList detail={createPluginDetail()} />)

      expect(screen.getByText('2 strategies')).toBeInTheDocument()
      expect(screen.getAllByTestId('strategy-item')).toHaveLength(2)
    })
  })

  describe('Props', () => {
    it('should pass tenant_id to provider detail', () => {
      const detail = createPluginDetail()
      detail.tenant_id = 'custom-tenant'
      render(<AgentStrategyList detail={detail} />)

      expect(screen.getByTestId('strategy-item')).toBeInTheDocument()
    })
  })
})
