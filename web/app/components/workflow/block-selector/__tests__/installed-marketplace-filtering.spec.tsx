import type { ReactElement } from 'react'
import type { ToolWithProvider } from '../../types'
import type { TriggerWithProvider } from '../types'
import { screen, within } from '@testing-library/react'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/query'
import { useFeaturedTriggersRecommendations } from '@/service/use-plugins'
import { useAllTriggerPlugins, useInvalidateAllTriggerPlugins } from '@/service/use-triggers'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { BlockEnum } from '../../types'
import AllStartBlocks from '../all-start-blocks'
import DataSources from '../data-sources'
import { createPlugin } from './factories'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(() => 'en_US'),
  useLocale: vi.fn(() => 'en_US'),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(() => ({ theme: 'light' })),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: unknown) => (typeof key === 'string' ? key : 'translated'),
    }),
  }
})

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: vi.fn(),
  useInvalidateAllTriggerPlugins: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedTriggersRecommendations: vi.fn(),
}))

vi.mock('../tools', () => ({ default: () => null }))
vi.mock('../start-blocks', () => ({ default: () => null }))
vi.mock('../trigger-plugin/list', () => ({ default: () => null }))
vi.mock('../featured-triggers', () => ({ default: () => null }))

vi.mock('../marketplace-plugin/list', async () => {
  const { forwardRef } = await import('react')
  return {
    default: forwardRef<HTMLDivElement, { list: Array<{ plugin_id: string }> }>(({ list }, ref) => (
      <div ref={ref} data-testid="marketplace-list">
        {list.map((plugin) => (
          <span key={plugin.plugin_id}>{plugin.plugin_id}</span>
        ))}
      </div>
    )),
  }
})

const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)
const mockUseAllTriggerPlugins = vi.mocked(useAllTriggerPlugins)
const mockUseInvalidateAllTriggerPlugins = vi.mocked(useInvalidateAllTriggerPlugins)
const mockUseFeaturedTriggersRecommendations = vi.mocked(useFeaturedTriggersRecommendations)

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: { enable_marketplace: true },
  })

const marketplaceResult = (installedPluginId: string, availablePluginId: string) =>
  ({
    data: {
      pages: [
        {
          plugins: [
            createPlugin({ plugin_id: installedPluginId }),
            createPlugin({ plugin_id: availablePluginId }),
          ],
          page: 1,
          page_size: 40,
          total: 2,
        },
      ],
      pageParams: [1],
    },
    isFetching: false,
  }) as ReturnType<typeof useMarketplacePlugins>

describe('installed marketplace plugin filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseInvalidateAllTriggerPlugins.mockReturnValue(vi.fn())
    mockUseFeaturedTriggersRecommendations.mockReturnValue({
      plugins: [],
      isLoading: false,
    } as ReturnType<typeof useFeaturedTriggersRecommendations>)
  })

  it('excludes installed data-source plugins from marketplace search results', () => {
    mockUseMarketplacePlugins.mockReturnValue(
      marketplaceResult('installed-datasource', 'available-datasource'),
    )
    const installedProvider = {
      id: 'installed-datasource/provider',
      plugin_id: 'installed-datasource',
      name: 'installed-datasource',
      tools: [],
    } as ToolWithProvider

    render(
      <DataSources
        searchText="datasource"
        onSelect={vi.fn()}
        dataSources={[installedProvider]}
      />,
    )

    const marketplaceList = screen.getByTestId('marketplace-list')
    expect(within(marketplaceList).queryByText('installed-datasource')).not.toBeInTheDocument()
    expect(within(marketplaceList).getByText('available-datasource')).toBeInTheDocument()
  })

  it('excludes installed trigger plugins from marketplace search results', () => {
    mockUseMarketplacePlugins.mockReturnValue(
      marketplaceResult('installed-trigger', 'available-trigger'),
    )
    mockUseAllTriggerPlugins.mockReturnValue({
      data: [
        {
          id: 'installed-trigger/provider',
          plugin_id: 'installed-trigger',
          plugin_unique_identifier: 'installed-trigger@1.0.0',
        } as TriggerWithProvider,
      ],
    } as ReturnType<typeof useAllTriggerPlugins>)

    render(
      <AllStartBlocks
        searchText="trigger"
        onSelect={vi.fn()}
        availableBlocksTypes={[BlockEnum.TriggerPlugin]}
      />,
    )

    const marketplaceList = screen.getByTestId('marketplace-list')
    expect(within(marketplaceList).queryByText('installed-trigger')).not.toBeInTheDocument()
    expect(within(marketplaceList).getByText('available-trigger')).toBeInTheDocument()
  })
})
