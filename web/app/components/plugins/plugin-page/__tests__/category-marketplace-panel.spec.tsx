import type { PluginCategoryEnum } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum as Category } from '../../types'
import { getCategoryMarketplaceId } from '../category-marketplace'
import CategoryMarketplacePanel from '../category-marketplace-panel'

const mocks = vi.hoisted(() => ({
  canInstallPlugin: true,
  fetchNextPage: vi.fn(),
  installedPluginIds: ['installed/plugin'] as string[] | undefined,
  installedPluginIdsError: false,
  installedPluginIdsRefetch: vi.fn(),
  searchParams: undefined as unknown,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mocks.installedPluginIds,
    isError: mocks.installedPluginIdsError,
    isFetching: false,
    isPending: false,
    refetch: mocks.installedPluginIdsRefetch,
  }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        plugin: {
          installedIds: {
            get: {
              queryOptions: () => ({}),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: (searchParams: unknown) => {
    mocks.searchParams = searchParams
    return {
      data: {
        pages: [
          {
            plugins: [
              { name: 'Installed plugin', plugin_id: 'installed/plugin', type: 'plugin' },
              { name: 'Calendar', plugin_id: 'langgenius/calendar', type: 'plugin' },
            ],
          },
        ],
      },
      fetchNextPage: mocks.fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isPending: false,
    }
  },
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  usePluginSettingsAccess: () => ({ canInstallPlugin: mocks.canInstallPlugin }),
}))

vi.mock('@/app/components/plugins/marketplace/utils', () => ({
  getMarketplaceCategoryUrl: (category: PluginCategoryEnum) =>
    `https://marketplace.test/plugins/${category}`,
}))

vi.mock('@/app/components/plugins/marketplace/list', () => ({
  default: ({
    cardRender,
    plugins,
    showInstallButton,
  }: {
    cardRender: (plugin: { name: string; plugin_id: string; type: string }) => React.ReactNode
    plugins: { name: string; plugin_id: string; type: string }[]
    showInstallButton: boolean
  }) => (
    <div data-can-install={showInstallButton ? 'true' : 'false'} data-testid="marketplace-list">
      {plugins.map((plugin) => (
        <div key={plugin.plugin_id}>{cardRender(plugin)}</div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/provider-card', () => ({
  default: ({ payload }: { payload: { name: string } }) => <div>{payload.name}</div>,
}))

describe('CategoryMarketplacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canInstallPlugin = true
    mocks.installedPluginIds = ['installed/plugin']
    mocks.installedPluginIdsError = false
    mocks.searchParams = undefined
  })

  it.each([Category.trigger, Category.agent, Category.extension] as const)(
    'queries and links to the scoped %s marketplace',
    async (category) => {
      render(<CategoryMarketplacePanel category={category} searchText="calendar" />)

      await waitFor(() => {
        expect(mocks.searchParams).toEqual({
          category,
          exclude: ['installed/plugin'],
          page_size: 30,
          query: 'calendar',
          sort_by: 'install_count',
          sort_order: 'DESC',
          type: 'plugin',
        })
      })
      expect(
        screen.getByRole('link', { name: /plugin\.marketplace\.difyMarketplace/ }),
      ).toHaveAttribute('href', `https://marketplace.test/plugins/${category}`)
      expect(document.getElementById(getCategoryMarketplaceId(category))).toBeInTheDocument()
      expect(screen.getByText('Calendar')).toBeInTheDocument()
      expect(screen.queryByText('Installed plugin')).not.toBeInTheDocument()
    },
  )

  it('passes selected tags to the trigger marketplace search', async () => {
    render(
      <CategoryMarketplacePanel
        category={Category.trigger}
        searchText="calendar"
        tags={['search']}
      />,
    )

    await waitFor(() => {
      expect(mocks.searchParams).toMatchObject({
        category: Category.trigger,
        tags: ['search'],
      })
    })
  })

  it('keeps browsing available but hides install actions without permission', () => {
    mocks.canInstallPlugin = false

    render(<CategoryMarketplacePanel category={Category.trigger} searchText="" />)

    expect(screen.getByTestId('marketplace-list')).toHaveAttribute('data-can-install', 'false')
    expect(screen.getByText('Calendar')).toBeInTheDocument()
  })

  it('shows a retry action when installed plugin IDs cannot be loaded', () => {
    mocks.installedPluginIds = undefined
    mocks.installedPluginIdsError = true

    render(<CategoryMarketplacePanel category={Category.trigger} searchText="" />)

    expect(screen.getByRole('alert')).toHaveTextContent('common.errorBoundary.title')
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(mocks.installedPluginIdsRefetch).toHaveBeenCalledTimes(1)
    expect(mocks.searchParams).toBeUndefined()
  })

  it('supports collapsing and loading the next marketplace page', () => {
    render(<CategoryMarketplacePanel category={Category.extension} searchText="" />)

    const toggle = screen.getByRole('button', { name: 'plugin.list.source.marketplace' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('marketplace-list')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
