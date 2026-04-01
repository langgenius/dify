import type { ToolWithProvider } from '../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import { BlockEnum } from '../../types'
import DataSources from '../data-sources'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
}))

const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)
const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)

type UseMarketplacePluginsReturn = ReturnType<typeof useMarketplacePlugins>

const createToolProvider = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  id: 'langgenius/file',
  name: 'file',
  author: 'Dify',
  description: { en_US: 'desc', zh_Hans: '描述' },
  icon: 'icon',
  label: { en_US: 'File Source', zh_Hans: '文件源' },
  type: CollectionType.datasource,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'langgenius/file',
  meta: { version: '1.0.0' },
  tools: [
    {
      name: 'local-file',
      author: 'Dify',
      label: { en_US: 'Local File', zh_Hans: '本地文件' },
      description: { en_US: 'Load local files', zh_Hans: '加载本地文件' },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
  ...overrides,
})

const createSystemFeatures = (enableMarketplace: boolean) => ({
  ...defaultSystemFeatures,
  enable_marketplace: enableMarketplace,
})

const createGlobalPublicStoreState = (enableMarketplace: boolean) => ({
  systemFeatures: createSystemFeatures(enableMarketplace),
  setSystemFeatures: vi.fn(),
})

const createMarketplacePluginsMock = (
  overrides: Partial<UseMarketplacePluginsReturn> = {},
): UseMarketplacePluginsReturn => ({
  plugins: [],
  total: 0,
  resetPlugins: vi.fn(),
  queryPlugins: vi.fn(),
  queryPluginsWithDebounced: vi.fn(),
  cancelQueryPluginsWithDebounced: vi.fn(),
  isLoading: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  page: 0,
  ...overrides,
})

describe('DataSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGlobalPublicStore.mockImplementation(selector => selector(createGlobalPublicStoreState(false)))
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock())
  })

  // Data source tools should filter by search and normalize the default value payload.
  describe('Selection', () => {
    it('should add default file extensions for the built-in local file data source', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <DataSources
          searchText=""
          onSelect={onSelect}
          dataSources={[createToolProvider()]}
        />,
      )

      await user.click(screen.getByText('File Source'))
      await user.click(screen.getByText('Local File'))

      expect(onSelect).toHaveBeenCalledWith(BlockEnum.DataSource, expect.objectContaining({
        provider_name: 'file',
        datasource_name: 'local-file',
        datasource_label: 'Local File',
        fileExtensions: expect.arrayContaining(['txt', 'pdf', 'md']),
      }))
    })

    it('should filter providers by search text', () => {
      render(
        <DataSources
          searchText="searchable"
          onSelect={vi.fn()}
          dataSources={[
            createToolProvider({
              id: 'searchable-provider',
              name: 'searchable-provider',
              label: { en_US: 'Searchable Source', zh_Hans: '可搜索源' },
              tools: [{
                name: 'searchable-tool',
                author: 'Dify',
                label: { en_US: 'Searchable Tool', zh_Hans: '可搜索工具' },
                description: { en_US: 'desc', zh_Hans: '描述' },
                parameters: [],
                labels: [],
                output_schema: {},
              }],
            }),
            createToolProvider({
              id: 'other-provider',
              name: 'other-provider',
              label: { en_US: 'Other Source', zh_Hans: '其他源' },
            }),
          ]}
        />,
      )

      expect(screen.getByText('Searchable Source')).toBeInTheDocument()
      expect(screen.queryByText('Other Source')).not.toBeInTheDocument()
    })
  })

  // Marketplace search should only run when enabled and a search term is present.
  describe('Marketplace Search', () => {
    it('should query marketplace plugins for datasource search results', async () => {
      const queryPluginsWithDebounced = vi.fn()
      mockUseGlobalPublicStore.mockImplementation(selector => selector(createGlobalPublicStoreState(true)))
      mockUseMarketplacePlugins.mockReturnValue(createMarketplacePluginsMock({
        queryPluginsWithDebounced,
      }))

      render(
        <DataSources
          searchText="invoice"
          onSelect={vi.fn()}
          dataSources={[]}
        />,
      )

      await waitFor(() => {
        expect(queryPluginsWithDebounced).toHaveBeenCalledWith({
          query: 'invoice',
          category: PluginCategoryEnum.datasource,
        })
      })
    })
  })
})
