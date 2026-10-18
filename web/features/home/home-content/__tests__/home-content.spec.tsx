import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import type {
  BannerResponse,
  RecommendedAppDetailResponse,
  RecommendedAppInfoResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactNode } from 'react'
import type { StepByStepTourSessionState } from '@/app/components/step-by-step-tour/types'
import type { consoleClient } from '@/service/console'
import { zPostAppsImportsResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSetAtom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '@/app/components/explore/learn-dify/storage'
import {
  resetStepByStepTourSessionAtom,
  stepByStepTourSessionAtom,
} from '@/app/components/step-by-step-tour/state'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { DSLImportStatus } from '@/models/app'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createStepByStepTourService } from '@/test/fixtures/onboarding'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { AppACLPermission } from '@/utils/permission'
import { HomeContent } from '../home-content'

let tourSession: StepByStepTourSessionState = {}

function StepByStepTourSessionFixture({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: StepByStepTourSessionState
}) {
  useHydrateAtoms([[stepByStepTourSessionAtom, initialState]])

  return children
}

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1', name: 'Evan' },
  currentWorkspace: { id: 'workspace-1' },
  workspacePermissionKeys: [] as string[],
}))
const mockAgentPermissions = vi.hoisted(() => ({ canImport: false }))

let mockExploreData: { categories: string[]; allList: RecommendedAppResponse[] } | undefined = {
  categories: [],
  allList: [],
}
let mockLearnDifyApps: RecommendedAppResponse[] = []
let mockLearnDifyLoading = false
let mockWorkspaceApps: RecentAppResponse[] = []
let mockBanners: BannerResponse[] = []
const { importDSL, confirmImport, checkDependencies, push } = vi.hoisted(() => ({
  importDSL: vi.fn<typeof consoleClient.apps.imports.post>(),
  confirmImport: vi.fn<typeof consoleClient.apps.imports.byImportId.confirm.post>(),
  checkDependencies: vi.fn<typeof consoleClient.apps.imports.byAppId.checkDependencies.get>(),
  push: vi.fn(),
}))
type ImportResponse = Awaited<ReturnType<typeof consoleClient.apps.imports.post>>
const completedImport = zPostAppsImportsResponse.parse({
  id: 'import-1',
  status: DSLImportStatus.COMPLETED,
  app_id: 'created-app',
  app_mode: 'chat',
  permission_keys: [AppACLPermission.ViewLayout],
})
const pendingImport = zPostAppsImportsResponse.parse({
  id: 'import-1',
  status: DSLImportStatus.PENDING,
  imported_dsl_version: '0.9.0',
  current_dsl_version: '0.8.0',
})
const mockTrackEvent = vi.hoisted(() => vi.fn())
const mockGetRecommendedApp = vi.hoisted(() =>
  vi.fn<(input: { params: { app_id: string } }) => Promise<RecommendedAppDetailResponse>>(),
)
const mockStepByStepTour = createStepByStepTourService({
  manually_enabled_workspace_ids: ['workspace-1'],
})

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({ toast: toastMocks }))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push }),
}))

vi.mock('@/app/components/base/amplitude/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude/utils')>()),
  trackEvent: mockTrackEvent,
  flushEvents: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'onboarding.stepByStepTour.state.get': async () => mockStepByStepTour.state,
      'onboarding.stepByStepTour.state.patch': (input) => mockStepByStepTour.patchState(input),
      'explore.banners.get': async () => mockBanners,
      'explore.apps.get': async () => ({
        categories: mockExploreData?.categories ?? [],
        recommended_apps: mockExploreData?.allList ?? [],
      }),
      'explore.apps.learnDify.get': async () =>
        mockLearnDifyLoading
          ? new Promise<never>(() => {})
          : { recommended_apps: mockLearnDifyApps },
      'explore.apps.byAppId.get': mockGetRecommendedApp,
      'features.get': async () => zGetFeaturesResponse.parse({ apps: { size: 0, limit: 100 } }),
      'apps.recent.get': async () => ({ data: mockWorkspaceApps.slice(0, 8) }),
      'apps.imports.post': importDSL,
      'apps.imports.byImportId.confirm.post': confirmImport,
      'apps.imports.byAppId.checkDependencies.get': checkDependencies,
    }),
  }
})

vi.mock('@/app/components/explore/try-app', () => ({
  default: ({
    canCreate = true,
    createButtonStepByStepTourTarget,
    onCreate,
    onClose,
  }: {
    canCreate?: boolean
    createButtonStepByStepTourTarget?: string
    onCreate: () => void
    onClose: () => void
  }) => (
    <section aria-label="Template preview">
      {canCreate && (
        <button
          type="button"
          data-step-by-step-tour-target={createButtonStepByStepTourTarget}
          onClick={onCreate}
        >
          Create from preview
        </button>
      )}
      <button type="button" onClick={onClose}>
        Close preview
      </button>
    </section>
  ),
}))

type AppFixture = RecommendedAppResponse & { app: RecommendedAppInfoResponse }
type AppFixtureOverrides = Omit<Partial<RecommendedAppResponse>, 'app'> & {
  app?: Partial<RecommendedAppInfoResponse>
}

const createApp = (overrides: AppFixtureOverrides = {}): AppFixture => ({
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? 'chat',
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '😀',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Alpha',
  },
  can_trial: true,
  app_id: overrides.app_id ?? 'app-1',
  description: overrides.description ?? 'Alpha description',
  copyright: overrides.copyright ?? '',
  privacy_policy: overrides.privacy_policy ?? null,
  custom_disclaimer: overrides.custom_disclaimer ?? null,
  categories: overrides.categories ?? ['Writing'],
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
})

const createWorkspaceApp = (overrides: Partial<RecentAppResponse> = {}): RecentAppResponse => ({
  id: overrides.id ?? 'workspace-app-1',
  name: overrides.name ?? 'Workspace App',
  author_name: overrides.author_name ?? 'Evan',
  icon_type: overrides.icon_type ?? 'emoji',
  icon: overrides.icon ?? '😀',
  icon_background: overrides.icon_background ?? '#fff',
  icon_url: overrides.icon_url ?? null,
  mode: overrides.mode ?? 'chat',
  updated_at: overrides.updated_at ?? 1704153600,
  maintainer: overrides.maintainer ?? 'user-1',
  permission_keys: overrides.permission_keys,
})

const createBanner = (overrides: Partial<BannerResponse> = {}): BannerResponse => ({
  id: overrides.id ?? 'banner-1',
  status: overrides.status ?? 'enabled',
  link: overrides.link ?? 'https://example.com',
  content: overrides.content ?? {
    category: 'Featured',
    title: 'Explore Banner',
    description: 'Banner description',
    'img-src': 'https://example.com/banner.png',
  },
  sort: overrides.sort ?? 1,
  created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
})

const mockAppCreatePermission = (hasEditPermission: boolean) => {
  mockConsoleState.workspacePermissionKeys = hasEditPermission ? ['app.create_and_management'] : []
}

type RenderOptions = {
  hasEditPermission?: boolean
  enableExploreBanner?: boolean
  enableLearnApp?: boolean
  extra?: ReactNode
  deploymentEdition?: DeploymentEdition
  searchParams?: Record<string, string>
}

const localeInput = { query: { language: 'en-US' } }
const homeTemplatesQueryKey = consoleQuery.explore.apps.get.queryKey({ input: localeInput })
const exploreBannersQueryKey = consoleQuery.explore.banners.get.queryKey({ input: localeInput })
const recommendedAppQueryKey = (appId: string) =>
  consoleQuery.explore.apps.byAppId.get.queryKey({ input: { params: { app_id: appId } } })

const renderHomeContent = ({
  hasEditPermission = false,
  searchParams,
  ...options
}: RenderOptions = {}) => {
  mockAppCreatePermission(hasEditPermission)
  const { wrapper: ConsoleQueryWrapper, queryClient } = createConsoleQueryWrapper({
    accountProfile: mockConsoleState.userProfile,
    currentWorkspace: mockConsoleState.currentWorkspace,
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
    features: { apps: { size: 0, limit: 100 } },
    systemFeatures: {
      deployment_edition: options.deploymentEdition ?? 'COMMUNITY',
      enable_explore_banner: options.enableExploreBanner ?? false,
      enable_learn_app: options.enableLearnApp ?? true,
    },
  })
  queryClient.setQueryData(
    consoleQuery.apps.recent.get.queryKey({ input: { query: { limit: 8 } } }),
    {
      data: mockWorkspaceApps.slice(0, 8),
    },
  )
  queryClient.setQueryData(consoleQuery.workspaces.current.rbac.myPermissions.get.queryKey(), {
    workspace: {
      permission_keys: [
        ...mockConsoleState.workspacePermissionKeys,
        ...(mockAgentPermissions.canImport ? ['agent.create'] : []),
      ],
    },
    app: { default_permission_keys: [], overrides: [] },
    dataset: { default_permission_keys: [], overrides: [] },
    agent: {
      default_permission_keys: mockAgentPermissions.canImport
        ? ['agent.acl.import_export_dsl']
        : [],
      overrides: [],
    },
  })
  if (mockExploreData) {
    queryClient.setQueryData(homeTemplatesQueryKey, {
      categories: mockExploreData.categories,
      recommended_apps: mockExploreData.allList,
    })
  }
  if (!mockLearnDifyLoading) {
    queryClient.setQueryData(
      consoleQuery.explore.apps.learnDify.get.queryKey({ input: localeInput }),
      {
        recommended_apps: mockLearnDifyApps,
      },
    )
  }
  if (options.enableExploreBanner) queryClient.setQueryData(exploreBannersQueryKey, mockBanners)
  queryClient.setQueryData(
    consoleQuery.onboarding.stepByStepTour.state.get.queryKey(),
    mockStepByStepTour.state,
  )

  const Wrapped = ({ children }: { children: ReactNode }) => (
    <ConsoleQueryWrapper>
      <StepByStepTourSessionFixture initialState={tourSession}>
        {children}
        {options.extra}
      </StepByStepTourSessionFixture>
    </ConsoleQueryWrapper>
  )
  const rendered = renderWithNuqs(
    <Wrapped>
      <HomeContent />
    </Wrapped>,
    { searchParams },
  )
  return { ...rendered, queryClient }
}

function SkipHomeGuideProbe() {
  const resetStepByStepTourSession = useSetAtom(resetStepByStepTourSessionAtom)

  return (
    <button type="button" onClick={resetStepByStepTourSession}>
      skip home guide
    </button>
  )
}

describe('HomeContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importDSL.mockReset().mockResolvedValue(completedImport)
    confirmImport.mockReset().mockResolvedValue(completedImport)
    checkDependencies.mockReset().mockResolvedValue({ leaked_dependencies: [] })
    sessionStorage.clear()
    mockGetRecommendedApp.mockReset().mockResolvedValue({
      id: 'app-1',
      name: 'Alpha',
      can_trial: true,
      export_data: 'yaml-content',
      mode: 'chat',
    })
    localStorage.clear()
    mockExploreData = { categories: [], allList: [] }
    mockLearnDifyApps = [
      createApp({
        app_id: 'learn-1',
        app: { ...createApp().app, id: 'learn-basic-1', name: 'Learn Workflow Basics' },
        description: 'Build your first workflow from a template.',
        position: 1,
      }),
      createApp({
        app_id: 'learn-2',
        app: { ...createApp().app, id: 'learn-basic-2', name: 'Learn Agent Basics' },
        description: 'Connect agent reasoning with tools.',
        position: 2,
      }),
    ]
    mockLearnDifyLoading = false
    mockWorkspaceApps = []
    mockBanners = []
    mockAgentPermissions.canImport = false
    mockStepByStepTour.reset()
    tourSession = {}
  })

  describe('Rendering', () => {
    it('should always render the page intro as the only h1 when the banner is disabled', () => {
      renderHomeContent()

      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'explore.banner.greeting:{"name":"Evan"}',
        }),
      ).toBeInTheDocument()
      expect(screen.getByText('explore.banner.tagline')).toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.queryByRole('link', { name: 'Explore Banner' })).not.toBeInTheDocument()
    })

    it('should not render learn dify content while learn dify items are loading', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockLearnDifyApps = []
      mockLearnDifyLoading = true

      renderHomeContent()

      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('should not show the learn dify placeholder when the section is hidden', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockLearnDifyApps = []
      mockLearnDifyLoading = true
      localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')

      renderHomeContent()

      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
    })

    it('requires Agent import permission for an Agent template even with app creation permission', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp({ app: { ...createApp().app, mode: 'agent' } })],
      }

      renderHomeContent({ hasEditPermission: true })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
    })

    it('allows Agent template creation with Agent import permission', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp({ app: { ...createApp().app, mode: 'agent' } })],
      }
      mockAgentPermissions.canImport = true

      renderHomeContent()

      expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    })

    it('should render continue work with the first eight workspace apps', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = [
        createWorkspaceApp({
          id: 'app-1',
          name: 'Email Reply',
          author_name: 'Evan',
          permission_keys: [AppACLPermission.Monitor],
        }),
        createWorkspaceApp({ id: 'app-2', name: 'Feature Copilot', author_name: 'Maggie' }),
        createWorkspaceApp({ id: 'app-3', name: 'Book Translation', author_name: 'Alex' }),
        createWorkspaceApp({ id: 'app-4', name: 'Logo Design', author_name: 'Taylor' }),
        createWorkspaceApp({ id: 'app-5', name: 'Data Summarizer', author_name: 'Robin' }),
        createWorkspaceApp({ id: 'app-6', name: 'Meeting Notes', author_name: 'Casey' }),
        createWorkspaceApp({ id: 'app-7', name: 'Research Helper', author_name: 'Jordan' }),
        createWorkspaceApp({ id: 'app-8', name: 'Support Draft', author_name: 'Morgan' }),
        createWorkspaceApp({ id: 'app-9', name: 'Hidden Ninth App', author_name: 'Riley' }),
      ]

      renderHomeContent()

      expect(
        screen.getByRole('heading', { name: 'explore.continueWork.title' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Email Reply')).toBeInTheDocument()
      expect(screen.getByText('Feature Copilot')).toBeInTheDocument()
      expect(screen.getByText('Book Translation')).toBeInTheDocument()
      expect(screen.getByText('Logo Design')).toBeInTheDocument()
      expect(screen.getByText('Data Summarizer')).toBeInTheDocument()
      expect(screen.getByText('Meeting Notes')).toBeInTheDocument()
      expect(screen.getByText('Research Helper')).toBeInTheDocument()
      expect(screen.getByText('Support Draft')).toBeInTheDocument()
      expect(screen.queryByText('Hidden Ninth App')).not.toBeInTheDocument()
      expect(screen.getByText('Maggie')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Email Reply/ })).toHaveAttribute(
        'href',
        '/app/app-1/overview',
      )
      expect(
        screen.getByRole('link', { name: 'explore.continueWork.exploreStudio' }),
      ).toHaveAttribute('href', '/apps')
    })

    it('should render preview-only continue work app as a dimmed card and warn on click', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = [
        createWorkspaceApp({
          id: 'preview-app',
          name: 'Preview Only App',
          author_name: 'Readonly Author',
          permission_keys: [AppACLPermission.Preview],
        }),
      ]

      renderHomeContent()

      const card = screen.getByRole('button', { name: /Preview Only App.*app\.types\.chatbot/ })
      expect(card).not.toHaveAttribute('aria-disabled')
      expect(screen.queryByRole('link', { name: /Preview Only App/ })).not.toBeInTheDocument()
      expect(screen.getByText('Readonly Author')).toBeInTheDocument()

      await user.click(card)

      expect(toastMocks.warning).toHaveBeenCalledWith('app.noAccessResourcePermission')
    })

    it('should hide continue work when there are no workspace apps', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockWorkspaceApps = []

      renderHomeContent()

      expect(
        screen.queryByRole('heading', { name: 'explore.continueWork.title' }),
      ).not.toBeInTheDocument()
    })

    it('exposes Learn Dify lessons as the home walkthrough target', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderHomeContent()

      const learnDifyHeading = await screen.findByRole('heading', {
        name: 'explore.learnDify.title',
      })
      expect(learnDifyHeading).toBeInTheDocument()
      expect(learnDifyHeading.closest('section')).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.home,
      )
      expect(screen.getByText('Learn Workflow Basics')).toBeInTheDocument()
      expect(screen.getByText('Learn Agent Basics')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'explore.learnDify.moreTemplates' }),
      ).not.toBeInTheDocument()
    })

    it('should hide learn dify templates when learn app is disabled', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderHomeContent({ enableLearnApp: false })

      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Learn Workflow Basics')).not.toBeInTheDocument()
    })

    it('should collapse learn dify and persist hidden state when hide is clicked', async () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      const { unmount } = renderHomeContent()

      const hideButton = await screen.findByRole('button', { name: 'explore.learnDify.hide' })
      const user = userEvent.setup()
      await user.click(hideButton)

      await waitFor(() => {
        expect(
          screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
        ).not.toBeInTheDocument()
      })

      expect(localStorage.getItem(LEARN_DIFY_HIDDEN_STORAGE_KEY)).toBe('true')
      unmount()
      renderHomeContent()
      expect(
        screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should filter apps by selected category', () => {
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [
          createApp(),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, name: 'Beta' },
            categories: ['Translate'],
          }),
        ],
      }

      renderHomeContent({ searchParams: { category: 'Writing' } })

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })

    it('should hide categories without apps even when the API returns them', () => {
      mockExploreData = {
        categories: ['Writing', 'c'],
        allList: [createApp()],
      }

      renderHomeContent({ searchParams: { category: 'c' } })

      expect(screen.queryByRole('radio', { name: 'c' })).not.toBeInTheDocument()
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })

    it('should keep selected category when clearing search text', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing', 'Translate'],
        allList: [
          createApp(),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, name: 'Beta' },
            categories: ['Translate'],
          }),
        ],
      }

      renderHomeContent({ searchParams: { category: 'Writing' } })

      const input = screen.getByRole('searchbox', {
        name: 'app.newAppFromTemplate.searchAllTemplate',
      })
      await user.type(input, 'alp')
      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should find templates by description and explain empty results', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [
          createApp({ description: 'Summarize invoices' }),
          createApp({
            app_id: 'app-2',
            app: { ...createApp().app, name: 'Gamma' },
            description: 'Translate documents',
          }),
        ],
      }
      renderHomeContent()

      const input = screen.getByRole('searchbox', {
        name: 'app.newAppFromTemplate.searchAllTemplate',
      })
      await user.type(input, 'INVOICE')

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.queryByText('Gamma')).not.toBeInTheDocument()

      await user.clear(input)
      await user.type(input, 'unmatched')

      expect(screen.getByText('app.newApp.noTemplateFound')).toBeInTheDocument()
      expect(screen.getByText('app.newApp.noTemplateFoundTip')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('app.newApp.noTemplateFound')
    })

    it('should handle create flow from app card when outside cloud edition and confirm DSL when pending', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      importDSL.mockResolvedValue(pendingImport)

      renderHomeContent({ hasEditPermission: true })
      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => {
        expect(mockGetRecommendedApp).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
      })
      expect(importDSL).toHaveBeenCalledWith({
        body: expect.objectContaining({ name: 'Alpha', yaml_content: 'yaml-content' }),
      })
      const confirm = within(
        await screen.findByRole('alertdialog', { name: 'app.newApp.appCreateDSLErrorTitle' }),
      )
      expect(confirm.getByText('0.9.0')).toBeInTheDocument()
      expect(confirm.getByText('0.8.0')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'app.newApp.Confirm' }))
      await waitFor(() => {
        expect(confirmImport).toHaveBeenCalledExactlyOnceWith({ params: { import_id: 'import-1' } })
        expect(mockTrackEvent).toHaveBeenCalledWith(
          'create_app',
          expect.objectContaining({
            source: 'explore_template_list',
            app_mode: 'chatflow',
            template_id: 'app-1',
          }),
        )
      })
      await waitFor(() => expect(push).toHaveBeenCalledWith('/app/created-app/configuration'))
    })

    it('should fetch the current template detail when creating an app', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockGetRecommendedApp.mockResolvedValue({
        id: 'app-1',
        name: 'Alpha',
        can_trial: true,
        export_data: 'latest-yaml',
        mode: 'chat' as const,
      })
      const { queryClient } = renderHomeContent({ hasEditPermission: true })
      queryClient.setQueryData(recommendedAppQueryKey('app-1'), {
        id: 'app-1',
        name: 'Alpha',
        can_trial: true,
        export_data: 'cached-yaml',
        mode: 'chat' as const,
      })
      await queryClient.invalidateQueries({
        queryKey: recommendedAppQueryKey('app-1'),
        exact: true,
        refetchType: 'none',
      })

      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => expect(importDSL).toHaveBeenCalledTimes(1))
      expect(mockGetRecommendedApp).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
      expect(importDSL).toHaveBeenCalledWith({
        body: expect.objectContaining({ yaml_content: 'latest-yaml' }),
      })
    })

    it('reports a template detail failure without starting an import', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockGetRecommendedApp.mockRejectedValue(new Error('Unavailable'))
      renderHomeContent({ hasEditPermission: true })

      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() =>
        expect(toastMocks.error).toHaveBeenCalledWith('app.newApp.appCreateFailed'),
      )
      expect(importDSL).not.toHaveBeenCalled()
    })

    it('should open create flow from learn dify item card click', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderHomeContent({ hasEditPermission: true })
      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => {
        expect(mockGetRecommendedApp).toHaveBeenCalledWith({ params: { app_id: 'learn-1' } })
      })
      await waitFor(() => expect(push).toHaveBeenCalledWith('/app/created-app/configuration'))
    })

    it('should advance the Learn Dify tour to the create button after a lesson opens', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
      }

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByRole('region', { name: 'Template preview' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create from preview' })).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )
    })

    it('should close the Learn Dify detail when the home action guide is skipped', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
      }

      renderHomeContent({
        hasEditPermission: true,
        extra: <SkipHomeGuideProbe />,
        deploymentEdition: 'CLOUD',
      })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByRole('region', { name: 'Template preview' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create from preview' })).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )

      await user.click(screen.getByRole('button', { name: 'skip home guide' }))

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Template preview' })).not.toBeInTheDocument()
      })
    })

    it('should complete the Learn Dify tour when a no-create user opens a lesson detail', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
      }

      renderHomeContent({ deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))

      expect(await screen.findByRole('region', { name: 'Template preview' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Create from preview' })).not.toBeInTheDocument()
      await waitFor(() => {
        expect(mockStepByStepTour.patchState.mock.calls.at(-1)?.[0]).toEqual({
          body: {
            action: 'complete_task',
            task_id: 'home',
          },
        })
      })
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'task_completed',
        completed_task_count: 1,
        home_outcome: 'lesson_opened',
        permission_variant: 'no_create',
        task_id: 'home',
        task_total: 4,
      })
    })

    it('should complete the Learn Dify tour only after the app is created from details', async () => {
      const user = userEvent.setup()
      const request = createDeferred<ImportResponse>()
      importDSL.mockReturnValueOnce(request.promise)
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
      }

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByRole('button', { name: 'Create from preview' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))
      await waitFor(() => expect(importDSL).toHaveBeenCalledOnce())
      expect(mockStepByStepTour.patchState).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
      await act(async () => request.resolve(completedImport))

      await waitFor(() => {
        expect(mockStepByStepTour.patchState.mock.calls.at(-1)?.[0]).toEqual({
          body: {
            action: 'complete_task',
            task_id: 'home',
          },
        })
      })
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'task_completed',
        completed_task_count: 1,
        home_outcome: 'lesson_app_created',
        permission_variant: 'full',
        task_id: 'home',
        task_total: 4,
      })
      await waitFor(() =>
        expect(checkDependencies).toHaveBeenCalledWith({ params: { app_id: 'created-app' } }),
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('should clear the Learn Dify session and provenance when completion persistence fails', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
      }
      mockStepByStepTour.patchState.mockRejectedValueOnce(new Error('patch failed'))

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByRole('button', { name: 'Create from preview' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => {
        expect(mockStepByStepTour.patchState).toHaveBeenCalledTimes(1)
      })
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        'step_tour',
        expect.objectContaining({
          action: 'task_completed',
          home_outcome: 'lesson_app_created',
        }),
      )

      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await user.click(await screen.findByRole('button', { name: 'Create from preview' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => {
        expect(importDSL).toHaveBeenCalledTimes(2)
      })
      await waitFor(() =>
        expect(push).toHaveBeenCalledExactlyOnceWith('/app/created-app/configuration'),
      )
      expect(mockStepByStepTour.patchState).toHaveBeenCalledTimes(1)
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        'step_tour',
        expect.objectContaining({
          action: 'task_completed',
          home_outcome: 'lesson_app_created',
        }),
      )
    })

    it('should skip redirect after confirming a pending Learn Dify tour create', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
      }
      importDSL.mockResolvedValue(pendingImport)

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      await user.click(await screen.findByRole('button', { name: 'Create from preview' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))
      await user.click(await screen.findByRole('button', { name: 'app.newApp.Confirm' }))

      await waitFor(() => {
        expect(confirmImport).toHaveBeenCalledWith({ params: { import_id: 'import-1' } })
        expect(checkDependencies).toHaveBeenCalledWith({ params: { app_id: 'created-app' } })
      })
      expect(push).not.toHaveBeenCalled()
    })

    it('should hide the Learn Dify tour target while the create modal is open and abandon on cancel', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      tourSession = {
        activeTaskId: 'home',
        activeGuideIndex: 0,
        activeGuideIndexes: [0, 1],
      }

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(await screen.findByRole('button', { name: 'Learn Workflow Basics' }))
      const createFromDetailsButton = await screen.findByRole('button', {
        name: 'Create from preview',
      })
      expect(createFromDetailsButton).toHaveAttribute(
        'data-step-by-step-tour-target',
        STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate,
      )

      await user.click(createFromDetailsButton)
      expect(
        await screen.findByRole('dialog', { name: /explore.appCustomize.title/ }),
      ).toBeInTheDocument()
      expect(createFromDetailsButton).not.toHaveAttribute('data-step-by-step-tour-target')

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Template preview' })).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should reset search results when clear icon is clicked', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [
          createApp(),
          createApp({ app_id: 'app-2', app: { ...createApp().app, name: 'Gamma' } }),
        ],
      }
      renderHomeContent()

      const input = screen.getByRole('searchbox', {
        name: 'app.newAppFromTemplate.searchAllTemplate',
      })
      await user.type(input, 'gam')
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('should close create modal via hide button', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderHomeContent({ hasEditPermission: true })
      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      expect(
        await screen.findByRole('dialog', { name: /explore.appCustomize.title/ }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: /explore.appCustomize.title/ }),
        ).not.toBeInTheDocument()
      })
      expect(mockTrackEvent).not.toHaveBeenCalledWith('create_app', expect.anything())
    })

    it.each(['failed response', 'request error'] as const)(
      'reports %s without navigating and allows a new import attempt',
      async (failure) => {
        const user = userEvent.setup()
        const request = createDeferred<ImportResponse>()
        importDSL.mockReturnValueOnce(request.promise)
        mockExploreData = { categories: ['Writing'], allList: [createApp()] }
        renderHomeContent({ hasEditPermission: true })
        await user.click(screen.getByRole('button', { name: 'Alpha' }))
        const dialog = await screen.findByRole('dialog', { name: /explore.appCustomize.title/ })
        const name = within(dialog).getByRole('textbox', { name: 'app.newApp.captionName' })
        await user.clear(name)
        await user.type(name, 'My imported app')
        const create = within(dialog).getByRole('button', { name: /common.operation.create/ })
        await user.click(create)
        await waitFor(() => expect(importDSL).toHaveBeenCalledOnce())
        await waitFor(() => expect(dialog).not.toBeInTheDocument())
        expect(importDSL).toHaveBeenCalledWith({
          body: expect.objectContaining({ name: 'My imported app', yaml_content: 'yaml-content' }),
        })
        expect(push).not.toHaveBeenCalled()
        await act(async () => {
          if (failure === 'failed response')
            request.resolve(
              zPostAppsImportsResponse.parse({
                id: 'import-1',
                status: DSLImportStatus.FAILED,
                error: 'Import unavailable',
              }),
            )
          else request.reject(new Error('Import unavailable'))
        })
        await waitFor(() =>
          expect(toastMocks.error).toHaveBeenCalledWith('app.newApp.appCreateFailed', {
            description: 'Import unavailable',
          }),
        )
        expect(push).not.toHaveBeenCalled()
        expect(checkDependencies).not.toHaveBeenCalled()
        expect(mockTrackEvent).not.toHaveBeenCalledWith('create_app', expect.anything())
        await user.click(screen.getByRole('button', { name: 'Alpha' }))
        await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))
        await waitFor(() => expect(push).toHaveBeenCalledWith('/app/created-app/configuration'))
        expect(importDSL).toHaveBeenLastCalledWith({
          body: expect.objectContaining({ name: 'Alpha', yaml_content: 'yaml-content' }),
        })
      },
    )

    it('should cancel DSL confirm modal', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      importDSL.mockResolvedValue(pendingImport)

      renderHomeContent({ hasEditPermission: true })
      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => {
        expect(
          screen.getByRole('alertdialog', { name: 'app.newApp.appCreateDSLErrorTitle' }),
        ).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))
      await waitFor(() => {
        expect(
          screen.queryByRole('alertdialog', { name: 'app.newApp.appCreateDSLErrorTitle' }),
        ).not.toBeInTheDocument()
      })
      expect(confirmImport).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('TryApp Panel', () => {
    it('should track preview source when creation starts from try app details', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      await screen.findByRole('region', { name: 'Template preview' })
      await user.click(screen.getByRole('button', { name: 'Create from preview' }))
      await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))

      await waitFor(() => {
        expect(mockTrackEvent).toHaveBeenCalledWith(
          'create_app',
          expect.objectContaining({
            source: 'explore_template_preview',
            app_mode: 'chatflow',
            template_id: 'app-1',
          }),
        )
      })
    })

    it('should close try app panel when close is clicked', async () => {
      const user = userEvent.setup()
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }

      renderHomeContent({ hasEditPermission: true, deploymentEdition: 'CLOUD' })

      await user.click(screen.getByRole('button', { name: 'Alpha' }))
      expect(await screen.findByRole('region', { name: 'Template preview' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Close preview' }))
      expect(screen.queryByRole('region', { name: 'Template preview' })).not.toBeInTheDocument()
    })
  })

  describe('Banner', () => {
    it('should render banner when enable_explore_banner is true', () => {
      mockExploreData = {
        categories: ['Writing'],
        allList: [createApp()],
      }
      mockBanners = [createBanner()]

      renderHomeContent({ enableExploreBanner: true })

      expect(screen.getByRole('link', { name: 'Explore Banner' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Explore Banner' })).toHaveAttribute(
        'href',
        'https://example.com',
      )
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    })
  })
})
