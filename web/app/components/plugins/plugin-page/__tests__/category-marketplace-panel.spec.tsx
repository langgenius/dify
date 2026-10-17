import type { PluginCategoryEnum } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { PluginCategoryEnum as Category } from '../../types'
import CategoryMarketplacePanel from '../category-marketplace-panel'

const mocks = vi.hoisted(() => ({
  canInstallPlugin: true,
  fetchNextPage: vi.fn(),
  getInstalledIds: vi.fn(),
  searchParams: undefined as unknown,
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
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

let seedIds = true
const render = (ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  if (seedIds)
    queryClient.setQueryDefaults(consoleQuery.workspaces.current.plugin.installedIds.get.key(), {
      initialData: { plugin_ids: ['installed/plugin'] },
    })
  return renderWithConsoleQuery(ui, { queryClient })
}
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.installedIds.get': mocks.getInstalledIds,
    }),
  }
})

describe('CategoryMarketplacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canInstallPlugin = true
    seedIds = true
    mocks.getInstalledIds.mockResolvedValue({ plugin_ids: ['installed/plugin'] })
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

  it('retries installed plugin IDs after a request failure and resumes marketplace search', async () => {
    const user = userEvent.setup()
    seedIds = false
    mocks.getInstalledIds.mockRejectedValueOnce(new Error('Unavailable'))
    render(<CategoryMarketplacePanel category={Category.trigger} searchText="" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('common.errorBoundary.title')
    expect(mocks.searchParams).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(mocks.getInstalledIds).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Calendar')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.searchParams).toMatchObject({ exclude: ['installed/plugin'] })
  })

  it('supports collapsing and loading the next marketplace page', async () => {
    const user = userEvent.setup()
    render(<CategoryMarketplacePanel category={Category.extension} searchText="" />)

    const toggle = screen.getByRole('button', { name: 'plugin.list.source.marketplace' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('marketplace-list')).not.toBeInTheDocument()

    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
