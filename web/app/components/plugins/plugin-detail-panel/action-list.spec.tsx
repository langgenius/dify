import type { PluginDetail } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActionList from './action-list'

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.num !== undefined)
        return `${options.num} ${options.action || 'actions'}`
      return key
    },
  }),
}))

const mockToolData = [
  { name: 'tool-1', label: { en_US: 'Tool 1' } },
  { name: 'tool-2', label: { en_US: 'Tool 2' } },
]

const mockProvider = {
  name: 'test-plugin/test-tool',
  type: 'builtin',
}

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => ({ data: [mockProvider] }),
  useBuiltinTools: (key: string) => ({
    data: key ? mockToolData : undefined,
  }),
}))

vi.mock('@/app/components/tools/provider/tool-item', () => ({
  default: ({ tool }: { tool: { name: string } }) => (
    <div data-testid="tool-item">{tool.name}</div>
  ),
}))

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    tool: {
      identity: {
        author: 'test-author',
        name: 'test-tool',
        description: { en_US: 'Test' },
        icon: 'icon.png',
        label: { en_US: 'Test Tool' },
        tags: [],
      },
      credentials_schema: [],
    },
  } as unknown as PluginDetail['declaration'],
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
  ...overrides,
})

describe('ActionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render tool items when data is available', () => {
      const detail = createPluginDetail()
      render(<ActionList detail={detail} />)

      expect(screen.getByText('2 actions')).toBeInTheDocument()
      expect(screen.getAllByTestId('tool-item')).toHaveLength(2)
    })

    it('should render tool names', () => {
      const detail = createPluginDetail()
      render(<ActionList detail={detail} />)

      expect(screen.getByText('tool-1')).toBeInTheDocument()
      expect(screen.getByText('tool-2')).toBeInTheDocument()
    })

    it('should return null when no tool declaration', () => {
      const detail = createPluginDetail({
        declaration: {} as PluginDetail['declaration'],
      })
      const { container } = render(<ActionList detail={detail} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should return null when providerKey is empty', () => {
      const detail = createPluginDetail({
        declaration: {
          tool: {
            identity: undefined,
          },
        } as unknown as PluginDetail['declaration'],
      })
      const { container } = render(<ActionList detail={detail} />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('Props', () => {
    it('should use plugin_id in provider key construction', () => {
      const detail = createPluginDetail()
      render(<ActionList detail={detail} />)

      // The provider key is constructed from plugin_id and tool identity name
      // When they match the mock, it renders
      expect(screen.getByText('2 actions')).toBeInTheDocument()
    })
  })
})
