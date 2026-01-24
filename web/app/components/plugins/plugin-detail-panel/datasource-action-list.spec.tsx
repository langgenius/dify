import type { PluginDetail } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatasourceActionList from './datasource-action-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.num !== undefined)
        return `${options.num} ${options.action || 'actions'}`
      return key
    },
  }),
}))

const mockDataSourceList = [
  { plugin_id: 'test-plugin', name: 'Data Source 1' },
]

let mockDataSourceListData: typeof mockDataSourceList | undefined

vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: () => ({ data: mockDataSourceListData }),
}))

vi.mock('@/app/components/workflow/block-selector/utils', () => ({
  transformDataSourceToTool: (ds: unknown) => ds,
}))

const createPluginDetail = (): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    datasource: {
      identity: {
        author: 'test-author',
        name: 'test-datasource',
        description: { en_US: 'Test' },
        icon: 'icon.png',
        label: { en_US: 'Test Datasource' },
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
})

describe('DatasourceActionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataSourceListData = mockDataSourceList
  })

  describe('Rendering', () => {
    it('should render action count when data and provider exist', () => {
      render(<DatasourceActionList detail={createPluginDetail()} />)

      // The component always shows "0 action" because data is hardcoded as empty array
      expect(screen.getByText('0 action')).toBeInTheDocument()
    })

    it('should return null when no provider found', () => {
      mockDataSourceListData = []
      const { container } = render(<DatasourceActionList detail={createPluginDetail()} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should return null when dataSourceList is undefined', () => {
      mockDataSourceListData = undefined
      const { container } = render(<DatasourceActionList detail={createPluginDetail()} />)

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('Props', () => {
    it('should use plugin_id to find matching datasource', () => {
      const detail = createPluginDetail()
      detail.plugin_id = 'different-plugin'
      mockDataSourceListData = [{ plugin_id: 'different-plugin', name: 'Different DS' }]

      render(<DatasourceActionList detail={detail} />)

      expect(screen.getByText('0 action')).toBeInTheDocument()
    })
  })
})
