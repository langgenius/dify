import type { Import } from '@dify/contracts/api/console/apps/types.gen'
import type {
  RecommendedAppDetailResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { RosterToolbar } from '../roster-toolbar'

const permissions = vi.hoisted(() => ({ canCreate: true, canImport: true }))
const push = vi.hoisted(() => vi.fn())

const agentTemplate = {
  app_id: 'agent-template',
  app: {
    id: 'source-agent',
    mode: 'agent',
    name: 'Support Agent',
    icon_type: 'emoji',
    icon: '\u{1F916}',
    icon_background: null,
    icon_url: null,
  },
  can_trial: false,
} satisfies RecommendedAppResponse

vi.mock('@/features/agent-v2/permissions', () => ({
  useCanCreateAgents: () => permissions.canCreate,
  useCanImportAgents: () => permissions.canImport,
}))

vi.mock('@/features/app-creation/dsl-dialog', () => ({
  default: ({ show, onSuccess }: { show: boolean; onSuccess?: () => void }) =>
    show ? (
      <div role="dialog" aria-label="agentRoster.roster.importDSL">
        <button onClick={onSuccess}>Complete agent import</button>
      </div>
    ) : null,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': async () => zGetFeaturesResponse.parse({ apps: { size: 0, limit: 0 } }),
      'explore.apps.byAppId.get': async () =>
        ({
          id: agentTemplate.app_id,
          name: agentTemplate.app.name,
          mode: 'agent',
          can_trial: false,
          export_data: '',
          version_id: 'version-1',
        }) satisfies RecommendedAppDetailResponse,
      'apps.imports.post': async () =>
        ({
          id: 'template-import',
          app_id: 'created-agent-app',
          app_mode: 'agent',
          status: 'completed',
        }) satisfies Import,
      'apps.imports.byAppId.checkDependencies.get': async () => ({ leaked_dependencies: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.get': async () =>
        createAppDetailFixture({ id: 'created-agent-app', mode: 'agent' }),
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push }),
}))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: vi.fn() }))

const renderToolbar = ({
  deploymentEdition = 'CLOUD',
  publicationCounts = { drafts: 2, published: 1 },
  searchParams = '',
}: {
  deploymentEdition?: GetSystemFeaturesResponse['deployment_edition']
  publicationCounts?: { drafts: number; published: number }
  searchParams?: string
} = {}) => {
  const { queryClient, wrapper: ConsoleQueryProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition },
    features: { apps: { size: 0, limit: 0 } },
  })

  const result = renderWithNuqs(
    <ConsoleQueryProvider>
      <RosterToolbar publicationCounts={publicationCounts} />
    </ConsoleQueryProvider>,
    { searchParams },
  )

  return { ...result, queryClient }
}

describe('RosterToolbar', () => {
  beforeEach(() => {
    permissions.canCreate = true
    permissions.canImport = true
  })

  it.each([
    { canCreate: true, canImport: false },
    { canCreate: true, canImport: true },
  ])('keeps SaaS creation actions permission-gated: %o', async (grants) => {
    const user = userEvent.setup()
    Object.assign(permissions, grants)
    renderToolbar()

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(Boolean(screen.queryByRole('menuitem', { name: 'app.newApp.startFromBlank' }))).toBe(
      grants.canCreate,
    )
    expect(Boolean(screen.queryByRole('menuitem', { name: /app\.importApp/ }))).toBe(
      grants.canImport,
    )
    expect(Boolean(screen.queryByRole('menuitem', { name: 'app.newApp.startFromTemplate' }))).toBe(
      grants.canImport,
    )
  })

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'hides Agent template creation in %s while retaining blank creation and import',
    async (deploymentEdition) => {
      const user = userEvent.setup()
      renderToolbar({ deploymentEdition })

      await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

      expect(
        screen.queryByRole('menuitem', { name: 'app.newApp.startFromTemplate' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /app\.importApp/ })).toBeInTheDocument()
    },
  )

  it('opens the Agent template picker in SaaS', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderToolbar()
    queryClient.setQueryData(
      consoleQuery.explore.apps.get.queryOptions({
        input: { query: { language: 'en-US' } },
      }).queryKey,
      { recommended_apps: [], categories: [] },
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    await user.click(screen.getByRole('menuitem', { name: 'app.newApp.startFromTemplate' }))

    expect(
      await screen.findByRole('dialog', { name: 'app.newApp.startFromTemplate' }),
    ).toBeInTheDocument()
  })

  it('closes the Agent template picker once an Agent is created', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderToolbar()
    queryClient.setQueryData(
      consoleQuery.explore.apps.get.queryOptions({
        input: { query: { language: 'en-US' } },
      }).queryKey,
      { recommended_apps: [agentTemplate], categories: [] },
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))
    await user.click(screen.getByRole('menuitem', { name: 'app.newApp.startFromTemplate' }))
    const dialog = await screen.findByRole('dialog', { name: 'app.newApp.startFromTemplate' })

    await user.click(
      await screen.findByRole('button', { name: 'app.newApp.useTemplate Support Agent' }),
    )
    await user.click(screen.getByRole('button', { name: /^common\.operation\.create/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/agents'))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('hides the create menu when neither action is permitted', () => {
    permissions.canCreate = false
    permissions.canImport = false
    renderToolbar()

    expect(
      screen.queryByRole('button', { name: 'common.operation.create' }),
    ).not.toBeInTheDocument()
  })

  it('opens the shared create menu for blank Agent creation and App import', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderToolbar()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: 'common.operation.create' }))

    expect(screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /app\.importApp/ })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /app\.importApp/ }))

    expect(
      await screen.findByRole('dialog', { name: 'agentRoster.roster.importDSL' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Complete agent import' }))

    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: consoleQuery.agent.get.key(),
    })
  })

  it('enables roster filters and emits the selected filter', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const publishedFilter = screen.getByRole('radio', {
      name: /agentRoster\.roster\.filters\.published/,
    })
    const draftsFilter = screen.getByRole('radio', { name: /agentRoster\.roster\.filters\.drafts/ })

    expect(publishedFilter).toBeEnabled()
    expect(draftsFilter).toBeEnabled()

    await user.click(publishedFilter)

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?filter=published',
      }),
    )
  })

  it('renders created-by-me filtering and emits checked state', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const createdByMeFilter = screen.getByRole('checkbox', {
      name: 'agentRoster.roster.filters.createdByMe',
    })

    expect(createdByMeFilter).toHaveAttribute('aria-checked', 'false')

    await user.click(createdByMeFilter)

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?created_by_me=true',
      }),
    )
  })

  it.each([
    ['earliest_created', 'agentRoster.roster.sort.earliestCreated'],
    ['invalid', 'agentRoster.roster.sort.lastModified'],
  ])('resolves URL sort %s to its selected label', (sortBy, label) => {
    renderToolbar({ searchParams: `?sort_by=${sortBy}` })

    expect(
      screen.getByRole('combobox', { name: 'agentRoster.roster.sort.label' }),
    ).toHaveTextContent(label)
  })

  it('renders sort options and emits the selected sort strategy', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderToolbar()

    const sortSelect = screen.getByRole('combobox', { name: 'agentRoster.roster.sort.label' })

    expect(screen.getByText('agentRoster.roster.sort.lastModified')).toBeInTheDocument()

    await user.click(sortSelect)
    await user.click(
      await screen.findByRole('option', { name: 'agentRoster.roster.sort.recentlyCreated' }),
    )

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?sort_by=recently_created',
      }),
    )
    expect(sortSelect).toHaveTextContent('agentRoster.roster.sort.recentlyCreated')
  })
})
