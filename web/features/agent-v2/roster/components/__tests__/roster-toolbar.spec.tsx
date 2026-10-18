import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { RosterToolbar } from '../roster-toolbar'

const permissions = vi.hoisted(() => ({ canCreate: true, canImport: true }))

vi.mock('@/features/agent-v2/permissions', () => ({
  useCanCreateAgents: () => permissions.canCreate,
  useCanImportAgents: () => permissions.canImport,
}))

vi.mock('@/app/components/app/create-from-dsl-modal', () => ({
  default: ({ show, onSuccess }: { show: boolean; onSuccess?: () => void }) =>
    show ? (
      <div role="dialog" aria-label="agentRoster.roster.importDSL">
        <button onClick={onSuccess}>Complete agent import</button>
      </div>
    ) : null,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

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
