import type { ComponentProps } from 'react'
import type { consoleClient } from '@/service/console'
import type { marketplaceClient } from '@/service/marketplace'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { zGetWorkspacesCurrentPluginMarketplacePkgResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from 'next-themes'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createMarketplacePluginFixture, createPluginEntity } from '@/test/fixtures/plugin'
import { PluginCategoryEnum as Category, PermissionType } from '../../types'
import CategoryMarketplacePanel from '../category-marketplace-panel'

const { getInstalledIds, search, declaration } = vi.hoisted(() => ({
  getInstalledIds: vi.fn<typeof consoleClient.workspaces.current.plugin.installedIds.get>(),
  search: vi.fn<typeof marketplaceClient.searchAdvanced>(),
  declaration: vi.fn<typeof consoleClient.workspaces.current.plugin.marketplace.pkg.get>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.installedIds.get': getInstalledIds,
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.marketplace.pkg.get': declaration,
    }),
  }
})

vi.mock('@/service/marketplace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/marketplace')>()),
  marketplaceClient: { searchAdvanced: search },
}))

const calendar = createMarketplacePluginFixture({
  org: 'langgenius',
  name: 'calendar',
  plugin_id: 'langgenius/calendar',
  label: { 'en-US': 'Calendar' },
  brief: { 'en-US': 'Calendar events' },
  latest_package_identifier: 'langgenius/calendar:1.0.0@checksum',
  category: Category.trigger,
})
const installed = createMarketplacePluginFixture({
  plugin_id: 'installed/plugin',
  label: { 'en-US': 'Installed plugin' },
  category: Category.trigger,
})

const setup = (
  props: Partial<ComponentProps<typeof CategoryMarketplacePanel>> = {},
  options: ConsoleQueryTestOptions = {},
) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  const rendered = renderWithConsoleQuery(
    <ThemeProvider defaultTheme="light" forcedTheme="light" enableSystem={false}>
      <CategoryMarketplacePanel category={Category.trigger} searchText="calendar" {...props} />
    </ThemeProvider>,
    {
      queryClient,
      accountProfileMeta: { currentVersion: '1.0.0' },
      workspacePermissionKeys: ['plugin.install'],
      systemFeatures: {
        deployment_edition: 'CLOUD',
        rbac_enabled: true,
        enable_marketplace: true,
      },
      ...options,
    },
  )
  return { ...rendered, user: userEvent.setup() }
}

beforeEach(() => {
  getInstalledIds.mockReset().mockResolvedValue({ plugin_ids: [installed.plugin_id] })
  search.mockReset().mockResolvedValue({ data: { plugins: [installed, calendar], total: 2 } })
  declaration.mockReset().mockResolvedValue(
    zGetWorkspacesCurrentPluginMarketplacePkgResponse.parse({
      manifest: {
        ...createPluginEntity().declaration,
        name: calendar.name,
        category: Category.trigger,
      },
    }),
  )
})

it.each([Category.trigger, Category.agent, Category.extension])(
  'searches the %s category with selected tags and excludes installed plugins',
  async (category) => {
    search.mockResolvedValue({
      data: {
        plugins: [
          { ...installed, category },
          { ...calendar, category },
        ],
        total: 2,
      },
    })
    setup({ category, tags: ['search'] })

    expect(await screen.findByRole('article', { name: 'Calendar' })).toBeVisible()
    expect(screen.queryByRole('article', { name: 'Installed plugin' })).not.toBeInTheDocument()
    expect(getInstalledIds).toHaveBeenCalledWith({ query: { category } })
    expect(search).toHaveBeenCalledWith(
      {
        params: { kind: 'plugins' },
        body: {
          category,
          query: 'calendar',
          tags: ['search'],
          page: 1,
          page_size: 30,
          sort_by: 'install_count',
          sort_order: 'DESC',
        },
      },
      expect.anything(),
    )
    const link = screen.getByRole('link', { name: 'plugin.marketplace.difyMarketplace' })
    const url = new URL(link.getAttribute('href')!, window.location.origin)
    expect(url.pathname).toBe(`/plugins/${category}`)
    expect(url.searchParams.get('theme')).toBe('light')
  },
)

it('shows provider information and opens the selected package in the real installer', async () => {
  const { user } = setup()
  const card = within(await screen.findByRole('article', { name: 'Calendar' }))
  expect(card.getByRole('heading', { name: 'Calendar' })).toBeVisible()
  expect(card.getByText('langgenius')).toBeVisible()
  expect(card.getByText('Calendar events')).toBeVisible()
  expect(card.getByText('42')).toBeVisible()
  expect(card.getByText('search')).toBeVisible()
  expect(card.getByText('agent')).toBeVisible()
  await user.click(
    card.getByRole('button', { name: 'plugin.detailPanel.operation.install Calendar' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
  expect(within(dialog).getByText('Calendar')).toBeVisible()
  await waitFor(() =>
    expect(declaration).toHaveBeenCalledWith({
      query: { plugin_unique_identifier: calendar.latest_package_identifier },
    }),
  )
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(
    card.getByRole('button', { name: 'plugin.detailPanel.operation.install Calendar' }),
  ).toBeVisible()
})

it.each(['CLOUD', 'COMMUNITY', 'ENTERPRISE'] as const)(
  'links provider details to the appropriate destination for %s',
  async (edition) => {
    setup({}, { systemFeatures: { deployment_edition: edition, rbac_enabled: true } })
    const card = within(await screen.findByRole('article', { name: 'Calendar' }))
    const link = card.getByRole('link', { name: 'plugin.detailPanel.operation.detail Calendar' })
    const url = new URL(link.getAttribute('href')!, window.location.origin)
    expect(url.pathname).toBe(`${edition === 'CLOUD' ? '/plugins' : '/plugin'}/langgenius/calendar`)
    expect(url.searchParams.get('language')).toBe('en-US')
    expect(url.searchParams.get('theme')).toBe('light')
    if (edition !== 'CLOUD') {
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.searchParams.get('source')).toBe(window.location.origin)
    }
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  },
)

it('keeps provider details available but hides installation without workspace permission', async () => {
  setup({}, { workspacePermissionKeys: [] })
  const card = within(await screen.findByRole('article', { name: 'Calendar' }))
  expect(
    card.getByRole('link', { name: 'plugin.detailPanel.operation.detail Calendar' }),
  ).toBeVisible()
  expect(
    card.queryByRole('button', { name: /plugin.detailPanel.operation.install/ }),
  ).not.toBeInTheDocument()
})

it('waits for installed IDs and resumes search after retrying a failed request', async () => {
  getInstalledIds.mockRejectedValueOnce(new Error('Unavailable'))
  const { user } = setup()
  expect(await screen.findByRole('alert')).toHaveTextContent('common.errorBoundary.title')
  expect(search).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(await screen.findByRole('article', { name: 'Calendar' })).toBeVisible()
  expect(screen.queryByRole('article', { name: 'Installed plugin' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('restores collapsed results and appends the next marketplace page', async () => {
  const firstPage = Array.from({ length: 30 }, (_, index) =>
    createMarketplacePluginFixture({
      ...calendar,
      plugin_id: `langgenius/calendar-${index}`,
      name: `calendar-${index}`,
      label: { 'en-US': `Calendar ${index + 1}` },
    }),
  )
  search
    .mockResolvedValueOnce({ data: { plugins: firstPage, total: 31 } })
    .mockResolvedValue({ data: { plugins: [calendar], total: 31 } })
  const { user } = setup()
  await screen.findByRole('article', { name: 'Calendar 1' })
  const toggle = screen.getByRole('button', { name: 'plugin.list.source.marketplace' })
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  await user.click(toggle)
  expect(await screen.findByRole('article', { name: 'Calendar 1' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'workflow.common.loadMore' }))
  expect(await screen.findByRole('article', { name: 'Calendar' })).toBeVisible()
  expect(screen.getAllByRole('article')).toHaveLength(31)
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: expect.objectContaining({ page: 2 }) }),
    expect.anything(),
  )
  expect(screen.queryByRole('button', { name: 'workflow.common.loadMore' })).not.toBeInTheDocument()
})
