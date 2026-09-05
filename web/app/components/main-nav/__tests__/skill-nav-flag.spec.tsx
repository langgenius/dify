import type { QueryClient } from '@tanstack/react-query'
import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from '@/app/components/main-nav/routes'
import { seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: { modelProviderDetails: ['common', 'model-provider-details'] },
  useModelListByType: () => ({ data: { data: [] } }),
  useSupportRetrievalMethods: () => ({ data: { retrieval_method: [] } }),
}))

function getSkillsRoute() {
  const route = MAIN_NAV_ROUTES.find((item) => item.key === 'skills')
  if (!route) throw new Error('Skills main-nav route is missing')
  return route
}

const skillsRoute = getSkillsRoute()

const skillNavVisibility = {
  agentV2Enabled: true,
  canManageAgents: true,
  canViewSkills: true,
  isCurrentWorkspaceDatasetOperator: false,
  marketplaceEnabled: true,
}

let ProviderContextProvider: typeof import('@/context/provider-context-provider').ProviderContextProvider
let createConsoleQueryWrapper: typeof import('@/test/console/query-data').createConsoleQueryWrapper
let consoleQuery: typeof import('@/service/client').consoleQuery
let useProviderContextSelector: typeof import('@/context/provider-context').useProviderContextSelector

function SkillNavRow() {
  const enableSkill = useProviderContextSelector((state) => state.enableSkill)
  const visible = isMainNavRouteVisible(skillsRoute, {
    ...skillNavVisibility,
    skillEnabled: enableSkill,
  })

  if (!visible) return null

  return <a href={skillsRoute.href}>Skills</a>
}

function seedModelProviderSummary(queryClient: QueryClient) {
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [],
    plugins: {},
  })
}

function simulateUnresolvedFeaturesQuery(queryClient: QueryClient) {
  const query = queryClient.getQueryCache().find({
    queryKey: consoleQuery.features.get.queryKey(),
  })

  if (!query) throw new Error('features query is missing from the cache')

  query.setState({
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchStatus: 'fetching',
    isInvalidated: true,
    status: 'pending',
  })
}

function renderSkillNav(queryClient: QueryClient) {
  const { wrapper } = createConsoleQueryWrapper({ queryClient })
  return render(
    <ProviderContextProvider>
      <SkillNavRow />
    </ProviderContextProvider>,
    { wrapper },
  )
}

describe('Skills nav feature flag', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()
    ;({ consoleQuery } = await import('@/service/client'))
    ;({ createConsoleQueryWrapper } = await import('@/test/console/query-data'))
    ;({ ProviderContextProvider } = await import('@/context/provider-context-provider'))
    ;({ useProviderContextSelector } = await import('@/context/provider-context'))
    const featuresQueryOptions = consoleQuery.features.get.queryOptions.bind(
      consoleQuery.features.get,
    )
    vi.spyOn(consoleQuery.features.get, 'queryOptions').mockImplementation((options) => ({
      ...featuresQueryOptions(options),
      queryFn: () => new Promise(() => {}),
    }))
  })

  it('keeps the Skills row visible when a cached enabled flag becomes unresolved', () => {
    const { queryClient } = createConsoleQueryWrapper()
    seedFeatures(queryClient, { enable_skill: true })
    seedModelProviderSummary(queryClient)

    renderSkillNav(queryClient)

    expect(screen.getByRole('link', { name: 'Skills' })).toBeInTheDocument()

    act(() => {
      simulateUnresolvedFeaturesQuery(queryClient)
    })

    expect(screen.getByRole('link', { name: 'Skills' })).toBeInTheDocument()
  })

  it('keeps the Skills row hidden when a cached disabled flag becomes unresolved', () => {
    const { queryClient } = createConsoleQueryWrapper()
    seedFeatures(queryClient, { enable_skill: false })
    seedModelProviderSummary(queryClient)

    renderSkillNav(queryClient)

    expect(screen.queryByRole('link', { name: 'Skills' })).not.toBeInTheDocument()

    act(() => {
      simulateUnresolvedFeaturesQuery(queryClient)
    })

    expect(screen.queryByRole('link', { name: 'Skills' })).not.toBeInTheDocument()
  })

  it('omits the Skills row until the flag resolves and never flashes it on then off', () => {
    const visibilityLog: boolean[] = []

    function SkillNavVisibilityLog() {
      const enableSkill = useProviderContextSelector((state) => state.enableSkill)
      visibilityLog.push(
        isMainNavRouteVisible(skillsRoute, {
          ...skillNavVisibility,
          skillEnabled: enableSkill,
        }),
      )
      return null
    }

    const { queryClient, wrapper } = createConsoleQueryWrapper()
    seedModelProviderSummary(queryClient)
    void queryClient.prefetchQuery({
      queryKey: consoleQuery.features.get.queryKey(),
      queryFn: () => new Promise(() => {}),
    })

    render(
      <ProviderContextProvider>
        <SkillNavVisibilityLog />
      </ProviderContextProvider>,
      { wrapper },
    )

    expect(screen.queryByRole('link', { name: 'Skills' })).not.toBeInTheDocument()
    expect(visibilityLog.length).toBeGreaterThan(0)
    expect(visibilityLog).not.toContain(true)
  })

  it('keeps the last known enabled flag across a provider remount without cache', () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    seedFeatures(queryClient, { enable_skill: true })
    seedModelProviderSummary(queryClient)

    const view = render(
      <ProviderContextProvider>
        <SkillNavRow />
      </ProviderContextProvider>,
      { wrapper },
    )

    expect(screen.getByRole('link', { name: 'Skills' })).toBeInTheDocument()

    view.unmount()
    queryClient.removeQueries({ queryKey: consoleQuery.features.get.queryKey() })
    void queryClient.prefetchQuery({
      queryKey: consoleQuery.features.get.queryKey(),
      queryFn: () => new Promise(() => {}),
    })

    render(
      <ProviderContextProvider>
        <SkillNavRow />
      </ProviderContextProvider>,
      { wrapper },
    )

    expect(screen.getByRole('link', { name: 'Skills' })).toBeInTheDocument()
  })
})
