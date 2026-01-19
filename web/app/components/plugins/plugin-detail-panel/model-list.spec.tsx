import type { PluginDetail } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelList from './model-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.num !== undefined)
        return `${options.num} models`
      return key
    },
  }),
}))

const mockModels = [
  { model: 'gpt-4', provider: 'openai' },
  { model: 'gpt-3.5', provider: 'openai' },
]

let mockModelListResponse: { data: typeof mockModels } | undefined

vi.mock('@/service/use-models', () => ({
  useModelProviderModelList: () => ({
    data: mockModelListResponse,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => (
    <span data-testid="model-icon">{modelName}</span>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-name', () => ({
  default: ({ modelItem }: { modelItem: { model: string } }) => (
    <span data-testid="model-name">{modelItem.model}</span>
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
    model: { provider: 'openai' },
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

describe('ModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelListResponse = { data: mockModels }
  })

  describe('Rendering', () => {
    it('should render model list when data is available', () => {
      render(<ModelList detail={createPluginDetail()} />)

      expect(screen.getByText('2 models')).toBeInTheDocument()
    })

    it('should render model icons and names', () => {
      render(<ModelList detail={createPluginDetail()} />)

      expect(screen.getAllByTestId('model-icon')).toHaveLength(2)
      expect(screen.getAllByTestId('model-name')).toHaveLength(2)
      // Both icon and name show the model name, so use getAllByText
      expect(screen.getAllByText('gpt-4')).toHaveLength(2)
      expect(screen.getAllByText('gpt-3.5')).toHaveLength(2)
    })

    it('should return null when no data', () => {
      mockModelListResponse = undefined
      const { container } = render(<ModelList detail={createPluginDetail()} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should handle empty model list', () => {
      mockModelListResponse = { data: [] }
      render(<ModelList detail={createPluginDetail()} />)

      expect(screen.getByText('0 models')).toBeInTheDocument()
      expect(screen.queryByTestId('model-icon')).not.toBeInTheDocument()
    })
  })
})
