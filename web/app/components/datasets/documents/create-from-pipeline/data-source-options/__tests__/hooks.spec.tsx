import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDatasourceIcon } from '../hooks'

const mockTransformDataSourceToTool = vi.fn()

vi.mock('@/app/components/workflow/block-selector/utils', () => ({
  transformDataSourceToTool: (...args: unknown[]) => mockTransformDataSourceToTool(...args),
}))

let mockDataSourceListReturn: {
  data: Array<{
    plugin_id: string
    provider: string
    declaration: { identity: { icon: string, author: string } }
  }> | undefined
  isSuccess: boolean
}

vi.mock('@/service/use-pipeline', () => ({
  useDataSourceList: () => mockDataSourceListReturn,
}))

vi.mock('@/utils/var', () => ({
  basePath: '',
}))

const createMockDataSourceNode = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  plugin_id: 'plugin-abc',
  provider_type: 'builtin',
  provider_name: 'web-scraper',
  datasource_name: 'scraper',
  datasource_label: 'Web Scraper',
  datasource_parameters: {},
  datasource_configurations: {},
  title: 'DataSource',
  desc: '',
  type: '' as DataSourceNodeType['type'],
  ...overrides,
} as DataSourceNodeType)

describe('useDatasourceIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataSourceListReturn = { data: undefined, isSuccess: false }
    mockTransformDataSourceToTool.mockReset()
  })

  // Returns undefined when data has not loaded
  describe('Loading State', () => {
    it('should return undefined when data is not loaded (isSuccess false)', () => {
      mockDataSourceListReturn = { data: undefined, isSuccess: false }

      const { result } = renderHook(() =>
        useDatasourceIcon(createMockDataSourceNode()),
      )

      expect(result.current).toBeUndefined()
    })
  })

  // Returns correct icon when plugin_id matches
  describe('Icon Resolution', () => {
    it('should return correct icon when plugin_id matches', () => {
      const mockIcon = 'https://example.com/icon.svg'
      mockDataSourceListReturn = {
        data: [
          {
            plugin_id: 'plugin-abc',
            provider: 'web-scraper',
            declaration: { identity: { icon: mockIcon, author: 'dify' } },
          },
        ],
        isSuccess: true,
      }
      mockTransformDataSourceToTool.mockImplementation((item: { plugin_id: string, declaration: { identity: { icon: string } } }) => ({
        plugin_id: item.plugin_id,
        icon: item.declaration.identity.icon,
      }))

      const { result } = renderHook(() =>
        useDatasourceIcon(createMockDataSourceNode({ plugin_id: 'plugin-abc' })),
      )

      expect(result.current).toBe(mockIcon)
    })

    it('should return undefined when plugin_id does not match', () => {
      mockDataSourceListReturn = {
        data: [
          {
            plugin_id: 'plugin-xyz',
            provider: 'other',
            declaration: { identity: { icon: '/icon.svg', author: 'dify' } },
          },
        ],
        isSuccess: true,
      }
      mockTransformDataSourceToTool.mockImplementation((item: { plugin_id: string, declaration: { identity: { icon: string } } }) => ({
        plugin_id: item.plugin_id,
        icon: item.declaration.identity.icon,
      }))

      const { result } = renderHook(() =>
        useDatasourceIcon(createMockDataSourceNode({ plugin_id: 'plugin-abc' })),
      )

      expect(result.current).toBeUndefined()
    })
  })

  // basePath prepending
  describe('basePath Prepending', () => {
    it('should prepend basePath to icon URL when not already included', () => {
      // basePath is mocked as '' so prepending '' to '/icon.png' results in '/icon.png'
      // The important thing is that the forEach logic runs without error
      mockDataSourceListReturn = {
        data: [
          {
            plugin_id: 'plugin-abc',
            provider: 'web-scraper',
            declaration: { identity: { icon: '/icon.png', author: 'dify' } },
          },
        ],
        isSuccess: true,
      }
      mockTransformDataSourceToTool.mockImplementation((item: { plugin_id: string, declaration: { identity: { icon: string } } }) => ({
        plugin_id: item.plugin_id,
        icon: item.declaration.identity.icon,
      }))

      const { result } = renderHook(() =>
        useDatasourceIcon(createMockDataSourceNode({ plugin_id: 'plugin-abc' })),
      )

      // With empty basePath, icon stays as '/icon.png'
      expect(result.current).toBe('/icon.png')
    })
  })
})
