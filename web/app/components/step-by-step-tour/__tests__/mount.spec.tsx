import type {
  StepByStepTourStatePatchPayload,
  StepByStepTourStateResponse,
} from '@dify/contracts/api/console/onboarding/types.gen'
import type { StepByStepTourSessionState, StepByStepTourTaskId } from '../types'
import type { ICurrentWorkspace } from '@/models/common'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { Plan } from '@/app/components/billing/type'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { createTestQueryClient } from '@/test/query-client'
import StepByStepTourMount from '../mount'
import { stepByStepTourSessionAtom } from '../state'
import { STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY } from '../storage'
import { STEP_BY_STEP_TOUR_TARGETS } from '../target-registry'

type StepByStepTourTestUiState = StepByStepTourSessionState & { minimized: boolean }

type StepByStepTourFixtureState = StepByStepTourSessionState & {
  completedTaskIds: StepByStepTourTaskId[]
  firstWorkspaceId?: string
  manuallyDisabledWorkspaceIds: string[]
  manuallyEnabledWorkspaceIds: string[]
  minimized: boolean
  skipped: boolean
  updatedAt?: string | null
}

type WorkspaceRole = ICurrentWorkspace['role']

const mockRouterPush = vi.fn()
const mockTrackEvent = vi.hoisted(() => vi.fn())
let mockPathname = '/apps'
const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: [
    'app.create_and_management',
    'dataset.create_and_management',
    'dataset.external.connect',
    'plugin.model_config',
    'plugin.plugin_preferences',
    'tool.manage',
    'mcp.manage',
    'api_extension.manage',
  ],
}))
const mockIsCurrentWorkspaceManager = vi.hoisted(() => ({
  value: true,
}))
const mockCurrentWorkspaceRole = vi.hoisted(() => ({
  value: 'owner' as WorkspaceRole,
}))
const mockEnableLearnApp = vi.hoisted(() => ({
  value: true,
}))
const mockEnableStepByStepTour = vi.hoisted(() => ({
  value: true,
}))
const mockHasBlockingModalOpen = vi.hoisted(() => ({
  value: false,
}))
const mockStepByStepTour = vi.hoisted(() => {
  const stateQueryKey = ['console', 'onboarding', 'step-by-step-tour', 'state'] as const
  const createState = (
    overrides: Partial<StepByStepTourStateResponse> = {},
  ): StepByStepTourStateResponse => ({
    first_workspace_id:
      overrides.first_workspace_id === undefined ? 'workspace-1' : overrides.first_workspace_id,
    skipped: overrides.skipped ?? false,
    completed_task_ids: overrides.completed_task_ids ?? [],
    manually_enabled_workspace_ids: overrides.manually_enabled_workspace_ids ?? [],
    manually_disabled_workspace_ids: overrides.manually_disabled_workspace_ids ?? [],
    updated_at: overrides.updated_at ?? '2026-07-01T00:00:00Z',
  })
  const createUiState = (
    overrides: Partial<StepByStepTourTestUiState> = {},
  ): StepByStepTourTestUiState => ({
    activeGuideGroup: undefined,
    activeGuideIndex: undefined,
    activeGuideIndexes: undefined,
    activeTaskId: undefined,
    minimized: false,
    ...overrides,
  })
  let state = createState()
  let uiState = createUiState()
  const patchState = vi.fn(
    async ({
      body,
    }: {
      body: StepByStepTourStatePatchPayload
    }): Promise<StepByStepTourStateResponse> => {
      switch (body.action) {
        case 'complete_task':
          state = {
            ...state,
            completed_task_ids:
              body.task_id && !state.completed_task_ids?.includes(body.task_id)
                ? [...(state.completed_task_ids ?? []), body.task_id]
                : state.completed_task_ids,
          }
          break
        case 'uncomplete_task':
          state = {
            ...state,
            completed_task_ids: (state.completed_task_ids ?? []).filter(
              (taskId) => taskId !== body.task_id,
            ),
          }
          break
        case 'skip':
          state = {
            ...state,
            skipped: true,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
            ),
          }
          break
        case 'enable_current_workspace':
          state = {
            ...state,
            skipped: false,
            manually_enabled_workspace_ids: Array.from(
              new Set([...(state.manually_enabled_workspace_ids ?? []), 'workspace-1']),
            ),
            manually_disabled_workspace_ids: (state.manually_disabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
            ),
          }
          break
        case 'disable_current_workspace':
          state = {
            ...state,
            manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
              (id) => id !== 'workspace-1',
            ),
            manually_disabled_workspace_ids: Array.from(
              new Set([...(state.manually_disabled_workspace_ids ?? []), 'workspace-1']),
            ),
          }
          break
      }

      return state
    },
  )

  return {
    get state() {
      return state
    },
    get uiState() {
      return uiState
    },
    patchState,
    reset() {
      state = createState()
      uiState = createUiState()
      patchState.mockClear()
    },
    setState(overrides: Partial<StepByStepTourStateResponse> = {}) {
      state = createState(overrides)
    },
    setTestState(nextState: Partial<StepByStepTourFixtureState>) {
      state = createState({
        completed_task_ids: nextState.completedTaskIds,
        first_workspace_id: nextState.firstWorkspaceId,
        manually_disabled_workspace_ids: nextState.manuallyDisabledWorkspaceIds,
        manually_enabled_workspace_ids: nextState.manuallyEnabledWorkspaceIds,
        skipped: nextState.skipped,
        updated_at: nextState.updatedAt,
      })
      uiState = createUiState({
        activeGuideGroup: nextState.activeGuideGroup,
        activeGuideIndex: nextState.activeGuideIndex,
        activeGuideIndexes: nextState.activeGuideIndexes,
        activeTaskId: nextState.activeTaskId,
        minimized: nextState.minimized,
      })
    },
    stateQueryKey,
  }
})

const setViewportSize = ({ height, width }: { height: number; width: number }) => {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
}

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: <T,>(selector: (state: { hasBlockingModalOpen: boolean }) => T) =>
    selector({
      hasBlockingModalOpen: mockHasBlockingModalOpen.value,
    }),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['console', 'system-features'],
      },
    },
    onboarding: {
      stepByStepTour: {
        state: {
          get: {
            queryKey: () => mockStepByStepTour.stateQueryKey,
            queryOptions: () => ({
              queryKey: mockStepByStepTour.stateQueryKey,
              queryFn: async () => mockStepByStepTour.state,
            }),
          },
          patch: {
            mutationOptions: (options = {}) => ({
              mutationFn: mockStepByStepTour.patchState,
              ...options,
            }),
          },
        },
      },
    },
  },
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'common.stepByStepTour.title': 'Get to know Dify',
      'common.stepByStepTour.duration': 'A quick tour — about 5 minutes',
      'common.stepByStepTour.guides.integration.dataSource.description':
        'Connect external data sources so Knowledge bases can pull from them.',
      'common.stepByStepTour.guides.integration.dataSource.title': 'Data Source',
      'common.stepByStepTour.guides.integration.mcp.description':
        'Connect MCP servers when your apps need access to external tools and services through MCP.',
      'common.stepByStepTour.guides.integration.mcp.title': 'MCP',
      'common.stepByStepTour.guides.integration.modelProvider.description':
        'Manage or install model providers here, set up model credentials, and check your Message Credits.',
      'common.stepByStepTour.guides.integration.modelProvider.title': 'Model Provider',
      'common.stepByStepTour.guides.integration.limitedAccess.dataSource.description':
        'Connect data sources here so Knowledge can bring in content from Drive, Notion, GitHub, Firecrawl, and more. Setup may require admin access.',
      'common.stepByStepTour.guides.integration.limitedAccess.mcp.description':
        'View connected MCP servers that expose external tools and services to apps. Adding or editing servers requires the right workspace permission.',
      'common.stepByStepTour.guides.integration.limitedAccess.modelProvider.description':
        'View model providers here, check model credentials, and see Message Credits. Installing or changing providers requires admin permission.',
      'common.stepByStepTour.guides.integration.limitedAccess.toolPlugin.description':
        'Browse installed tools and marketplace plugins that apps can call during execution. Ask an admin if you need to install or configure one.',
      'common.stepByStepTour.guides.integration.limitedAccess.trigger.description':
        'View triggers that turn third-party events into app inputs. Creating or managing triggers requires permission from your Workspace Owner or Admin.',
      'common.stepByStepTour.guides.integration.toolPlugin.description':
        'Manage built-in tools and marketplace plugins that apps can call during execution.',
      'common.stepByStepTour.guides.integration.toolPlugin.title': 'Tool Plugin',
      'common.stepByStepTour.guides.integration.trigger.description':
        'Convert third-party events into inputs your apps can act on.',
      'common.stepByStepTour.guides.integration.trigger.title': 'Trigger',
      'common.stepByStepTour.guides.integration.updateSettings.description':
        'Configure how integrations update automatically, including the update mode, scheduled time, and which integrations are included.',
      'common.stepByStepTour.guides.integration.updateSettings.title': 'Update Settings',
      'common.stepByStepTour.guides.home.create.description': 'Click here to make it yours',
      'common.stepByStepTour.guides.home.noCreate.description':
        'You can review lessons and see how Dify works here. Creating an app from a lesson requires a workspace where you have create permission, or help from an admin.',
      'common.stepByStepTour.guides.home.noCreate.title': 'Browse Learn Dify',
      'common.stepByStepTour.guides.home.pick.description': 'Pick a lesson to see how it works.',
      'common.stepByStepTour.guides.knowledge.empty.connect.description':
        'Already have a knowledge base elsewhere? Connect it via API — no data migration needed.',
      'common.stepByStepTour.guides.knowledge.empty.connect.title':
        'Connect to an external knowledge base',
      'common.stepByStepTour.guides.knowledge.empty.create.description':
        'Fastest way to get going. Upload documents and Dify handles chunking, indexing, and embedding for you. You can switch to custom anytime.',
      'common.stepByStepTour.guides.knowledge.empty.create.title':
        'Create a ready-to-use knowledge base',
      'common.stepByStepTour.guides.knowledge.empty.pipeline.description':
        'Define your own chunking, cleanup, and indexing flow when you need finer control over how documents become searchable.',
      'common.stepByStepTour.guides.knowledge.empty.pipeline.title':
        'Build a custom knowledge base',
      'common.stepByStepTour.guides.knowledge.withDatasets.create.description':
        'Use Create to add a new knowledge base — start ready-to-use, build a custom one from your documents, or connect to an external knowledge base.',
      'common.stepByStepTour.guides.knowledge.withDatasets.create.title':
        'Create a new knowledge base',
      'common.stepByStepTour.guides.knowledge.withDatasets.manage.description':
        'Tap any knowledge base to open its document management page — update documents, retrieval settings, and access from there.',
      'common.stepByStepTour.guides.knowledge.withDatasets.manage.title':
        'Open and manage each knowledge base',
      'common.stepByStepTour.guides.primaryActionLabel': 'Got it',
      'common.stepByStepTour.guides.studio.empty.blank.description':
        'Start from an empty canvas when you already know what to build.',
      'common.stepByStepTour.guides.studio.empty.blank.title': 'Create from blank',
      'common.stepByStepTour.guides.studio.empty.dsl.description':
        'Got a Dify DSL file? Import it here to restore an app you have shared or backed up.',
      'common.stepByStepTour.guides.studio.empty.dsl.title': 'Import a DSL file',
      'common.stepByStepTour.guides.studio.empty.learnDify.description':
        'New to Dify? Walk through a guided lesson first.',
      'common.stepByStepTour.guides.studio.empty.learnDify.title': 'Or start with Learn Dify',
      'common.stepByStepTour.guides.studio.empty.template.description':
        'Browse Dify templates and pick one that matches what you want to build.',
      'common.stepByStepTour.guides.studio.empty.template.title': 'Create from a template',
      'common.stepByStepTour.guides.studio.noCreate.empty.description':
        'You can view apps in this workspace, but there are no apps here yet. To create or edit apps, switch workspaces or ask your Workspace Owner or Admin for access.',
      'common.stepByStepTour.guides.studio.noCreate.empty.title': 'No apps to view yet',
      'common.stepByStepTour.guides.studio.noCreate.withApps.description':
        'You can browse apps in this workspace, but creating or editing apps requires permission. Switch to a workspace where you have access, or contact your Workspace Owner or Admin.',
      'common.stepByStepTour.guides.studio.noCreate.withApps.title': 'Studio is view-only for you',
      'common.stepByStepTour.guides.studio.withApps.create.description':
        'Use Create to add a new app — pick from a template, start from blank, or import a DSL file.',
      'common.stepByStepTour.guides.studio.withApps.create.title': 'Create a new app',
      'common.stepByStepTour.guides.studio.withApps.manage.description':
        'Tap any app to open its orchestration page — edit prompts, models, and logic, or manage its settings from there.',
      'common.stepByStepTour.guides.studio.withApps.manage.title': 'Open and manage each app',
      'common.stepByStepTour.skip': 'Skip tour',
      'common.stepByStepTour.skipRecovery.dismiss': 'Got it',
      'common.stepByStepTour.skipRecovery.label': 'Step-by-step Tour recovery tip',
      'common.stepByStepTour.skipRecovery.message':
        'Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.',
      'common.stepByStepTour.completion.description':
        'You’ve seen the essentials. Time to build something.',
      'common.stepByStepTour.completion.dismiss': 'Dismiss',
      'common.stepByStepTour.completion.label': 'Step-by-step Tour completed',
      'common.stepByStepTour.completion.title': 'You’re all set',
      'common.stepByStepTour.minimize': 'Minimize tour',
      'common.stepByStepTour.restore': 'Open step-by-step tour',
      'common.stepByStepTour.learnMore': 'Learn more',
      'common.stepByStepTour.markTaskComplete': 'Mark {{title}} complete',
      'common.stepByStepTour.markTaskIncomplete': 'Mark {{title}} incomplete',
      'common.stepByStepTour.progressAriaValueText': '{{completed}} of {{total}} steps completed',
      'common.stepByStepTour.stepLabel': '{{current}} of {{total}}',
      'common.stepByStepTour.tasks.home.title': 'Try a Learn Dify lesson',
      'common.stepByStepTour.tasks.home.description':
        'Open a hands-on lesson from Learn Dify to see Dify in action.',
      'common.stepByStepTour.tasks.home.noCreate.title': 'Browse Learn Dify',
      'common.stepByStepTour.tasks.home.noCreate.description':
        'You can review lessons and see how Dify works here. Creating an app from a lesson requires a workspace where you have create permission, or help from an admin.',
      'common.stepByStepTour.tasks.home.primaryActionLabel': 'Show me',
      'common.stepByStepTour.tasks.studio.title': 'Manage your apps in Studio',
      'common.stepByStepTour.tasks.studio.description':
        'All your apps live in Studio — edit, organize, and publish them here.',
      'common.stepByStepTour.tasks.studio.noCreate.title': 'Find your apps in Studio',
      'common.stepByStepTour.tasks.studio.noCreate.description':
        'You can browse apps in this workspace, but creating or editing apps requires permission. Switch to a workspace where you have access, or contact your Workspace Owner or Admin.',
      'common.stepByStepTour.tasks.studio.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.knowledge.title': 'Add your own data',
      'common.stepByStepTour.tasks.knowledge.description':
        'Build a knowledge base so your apps answer from your documents.',
      'common.stepByStepTour.tasks.knowledge.noPermission.title': 'Knowledge needs permission',
      'common.stepByStepTour.tasks.knowledge.noPermission.description':
        'To create or manage knowledge bases, switch to a workspace where you have access or contact your admin.',
      'common.stepByStepTour.tasks.knowledge.noPermission.primaryActionLabel': 'Got it',
      'common.stepByStepTour.tasks.knowledge.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.integration.title': 'Explore integrations',
      'common.stepByStepTour.tasks.integration.description':
        'Models, tools, data sources & more — explore what you can connect.',
      'common.stepByStepTour.tasks.integration.noPermission.title': 'Explore Integrations',
      'common.stepByStepTour.tasks.integration.noPermission.description':
        'Browse models, tools, and data sources, and see how they are managed.',
      'common.stepByStepTour.tasks.integration.primaryActionLabel': 'Take a look',
    }),
  }
})

function getMockAppContextState() {
  return {
    currentWorkspace: {
      id: 'workspace-1',
      name: 'Solar Studio',
      plan: Plan.sandbox,
      status: 'normal',
      role: mockCurrentWorkspaceRole.value,
      created_at: 0,
      providers: [],
      trial_credits: 0,
      trial_credits_used: 0,
      next_credit_reset_date: 0,
    },
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager.value,
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  } satisfies ConsoleStateFixture
}

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(getMockAppContextState)
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(getMockAppContextState)
})

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mockTrackEvent,
}))

type TestRect = {
  height: number
  left: number
  top: number
  width: number
}

const createTourElement = (
  dataAttributeName: 'stepByStepTourHighlightPart' | 'stepByStepTourTarget',
  targetName: string,
  rect: TestRect,
) => {
  const target = document.createElement('div')
  target.dataset[dataAttributeName] = targetName
  target.getBoundingClientRect = () => ({
    bottom: rect.top + rect.height,
    height: rect.height,
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    width: rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })
  document.body.appendChild(target)
  return target
}

const createTourTarget = (targetName: string, top = 114, rect?: Partial<TestRect>) =>
  createTourElement('stepByStepTourTarget', targetName, {
    height: 64,
    left: 472,
    top,
    width: 1012,
    ...rect,
  })

const createTourHighlightPart = (targetName: string, rect: TestRect) =>
  createTourElement('stepByStepTourHighlightPart', targetName, rect)

const createDeferred = <T,>() => {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })

  return { promise, reject, resolve }
}

const setStepByStepTourTestState = (state: Partial<StepByStepTourFixtureState>) => {
  mockStepByStepTour.setTestState(state)
  if (state.minimized !== undefined) {
    localStorage.setItem(
      STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY,
      state.minimized ? 'collapsed' : 'expanded',
    )
  }
}

const renderStepByStepTourMount = () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(mockStepByStepTour.stateQueryKey, mockStepByStepTour.state)
  queryClient.setQueryData(systemFeaturesQueryOptions().queryKey, {
    ...defaultSystemFeatures,
    deployment_edition: 'CLOUD',
    enable_learn_app: mockEnableLearnApp.value,
    enable_step_by_step_tour: mockEnableStepByStepTour.value,
  })
  const jotaiStore = createStore()
  seedRegisteredConsoleStateFixture(jotaiStore)
  jotaiStore.set(queryClientAtom, queryClient)
  jotaiStore.set(stepByStepTourSessionAtom, mockStepByStepTour.uiState)

  return render(
    <JotaiProvider store={jotaiStore}>
      <QueryClientProvider client={queryClient}>
        <StepByStepTourMount />
      </QueryClientProvider>
    </JotaiProvider>,
  )
}

const expectStepByStepTourPatch = async (body: StepByStepTourStatePatchPayload) => {
  await waitFor(() => {
    expect(mockStepByStepTour.patchState.mock.calls.at(-1)?.[0]).toEqual({ body })
  })
}

let user: ReturnType<typeof userEvent.setup>

describe('StepByStepTourMount', () => {
  beforeEach(() => {
    user = userEvent.setup()
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = [
      'app.create_and_management',
      'dataset.create_and_management',
      'dataset.external.connect',
      'plugin.model_config',
      'plugin.plugin_preferences',
      'tool.manage',
      'mcp.manage',
      'api_extension.manage',
    ]
    mockIsCurrentWorkspaceManager.value = true
    mockCurrentWorkspaceRole.value = 'owner'
    mockEnableLearnApp.value = true
    mockEnableStepByStepTour.value = true
    mockHasBlockingModalOpen.value = false
    mockPathname = '/apps'
    localStorage.clear()
    mockStepByStepTour.reset()
    setViewportSize({ height: 768, width: 1024 })
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
  })

  it('does not render the checklist when the Step-by-step Tour feature is disabled', async () => {
    mockEnableStepByStepTour.value = false

    renderStepByStepTourMount()

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })
  })

  it('renders the checklist for an eligible workspace', async () => {
    renderStepByStepTourMount()

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
  })

  it('keeps existing accounts hidden by default without a first workspace or manual enable', async () => {
    mockStepByStepTour.setState({
      first_workspace_id: null,
      manually_enabled_workspace_ids: [],
      manually_disabled_workspace_ids: [],
      completed_task_ids: [],
      skipped: false,
    })

    renderStepByStepTourMount()

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })
  })

  it('hides the checklist and shows a dismissible recovery hint after Skip', async () => {
    renderStepByStepTourMount()

    await user.click(await screen.findByRole('button', { name: 'Skip tour' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })
    expect(
      screen.getByRole('region', { name: 'Step-by-step Tour recovery tip' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.'),
    ).toBeInTheDocument()
    await expectStepByStepTourPatch({ action: 'skip' })

    await user.click(screen.getByRole('button', { name: 'Got it' }))

    expect(
      screen.queryByRole('region', { name: 'Step-by-step Tour recovery tip' }),
    ).not.toBeInTheDocument()
  })

  it('restores the checklist after Skip fails and allows retry', async () => {
    const deferred = createDeferred<StepByStepTourStateResponse>()
    mockStepByStepTour.patchState.mockImplementationOnce(() => deferred.promise)
    renderStepByStepTourMount()

    await user.click(await screen.findByRole('button', { name: 'Skip tour' }))

    await waitFor(() => {
      expect(mockStepByStepTour.patchState).toHaveBeenCalledTimes(1)
      expect(
        screen.getByRole('region', { name: 'Step-by-step Tour recovery tip' }),
      ).toBeInTheDocument()
    })
    deferred.reject(new Error('patch failed'))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'Step-by-step Tour recovery tip' }),
      ).not.toBeInTheDocument()
    })
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'step_tour',
      expect.objectContaining({ action: 'tour_skipped' }),
    )

    await user.click(screen.getByRole('button', { name: 'Skip tour' }))

    await waitFor(() => {
      expect(mockStepByStepTour.patchState).toHaveBeenCalledTimes(2)
      expect(
        screen.getByRole('region', { name: 'Step-by-step Tour recovery tip' }),
      ).toBeInTheDocument()
    })
  })

  it('shows a dismissible completion prompt at the bottom of the checklist after all tasks are complete', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge', 'integration'],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    expect(
      await screen.findByRole('region', { name: 'Step-by-step Tour completed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('You’re all set')).toBeInTheDocument()
    expect(
      screen.getByText('You’ve seen the essentials. Time to build something.'),
    ).toBeInTheDocument()

    const dismissButton = screen.getByRole('button', { name: 'Dismiss' })
    await user.click(dismissButton)

    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: 'Step-by-step Tour completed' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })
    await expectStepByStepTourPatch({ action: 'skip' })
  })

  it('uses a three-step checklist when Learn Dify is disabled', async () => {
    mockEnableLearnApp.value = false
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    expect(screen.queryByText('Try a Learn Dify lesson')).not.toBeInTheDocument()
    expect(screen.getByText('Manage your apps in Studio')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

    await user.click(screen.getAllByRole('button', { name: 'Take a look' })[0]!)

    expect(mockRouterPush).toHaveBeenCalledWith('/apps')
    expect(mockStepByStepTour.patchState).not.toHaveBeenCalled()
  })

  it('treats the three-step tour as complete when Learn Dify is disabled', async () => {
    mockEnableLearnApp.value = false
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['studio', 'knowledge', 'integration'],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(
      await screen.findByRole('region', { name: 'Step-by-step Tour completed' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(screen.queryByText('Try a Learn Dify lesson')).not.toBeInTheDocument()
  })

  it('persists the collapsed shell mode across remounts', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })

    const { unmount } = renderStepByStepTourMount()

    await user.click(await screen.findByRole('button', { name: 'Minimize tour' }))

    await waitFor(() => {
      expect(localStorage.getItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY)).toBe('collapsed')
    })
    expect(screen.getByRole('button', { name: 'Open step-by-step tour' })).toBeInTheDocument()

    unmount()
    renderStepByStepTourMount()

    expect(
      await screen.findByRole('button', { name: 'Open step-by-step tour' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open step-by-step tour' }))

    await waitFor(() => {
      expect(localStorage.getItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY)).toBe('expanded')
    })
    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
  })

  it('shows the completion prompt expanded even when the saved shell mode is collapsed', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY, 'collapsed')
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge', 'integration'],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(
      await screen.findByRole('region', { name: 'Step-by-step Tour completed' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open step-by-step tour' })).not.toBeInTheDocument()
  })

  it('hides expanded tour overlays while a blocking modal is open', async () => {
    mockHasBlockingModalOpen.value = true
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })

    renderStepByStepTourMount()

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })
    expect(document.body.querySelector('[data-base-ui-portal]')).not.toBeInTheDocument()
  })

  it('keeps the minimized tour entry available while a blocking modal is open', async () => {
    mockHasBlockingModalOpen.value = true
    localStorage.setItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY, 'collapsed')
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: [],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(
      await screen.findByRole('button', { name: 'Open step-by-step tour' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
  })

  it('starts the integration guide instead of immediately completing the task', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })

    renderStepByStepTourMount()

    await user.click(await screen.findByRole('button', { name: 'Take a look' }))

    expect(mockRouterPush).toHaveBeenCalledWith('/integrations/model-provider')
    expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
      action: 'task_started',
      permission_variant: 'full',
      task_id: 'integration',
    })
  })

  it('uses limited access integration guides when the workspace cannot manage integrations', async () => {
    mockIsCurrentWorkspaceManager.value = false
    mockCurrentWorkspaceRole.value = 'normal'
    mockWorkspacePermissionKeys.value = [
      'api_extension.manage',
      'plugin.install',
      'credential.use',
      'app_library.access',
    ]
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    ].map((targetName, index) =>
      createTourTarget(targetName, 80 + index * 8, {
        height: 40,
        left: 0,
        width: 200,
      }),
    )

    try {
      renderStepByStepTourMount()

      expect(
        await screen.findByText(
          'Browse models, tools, and data sources, and see how they are managed.',
        ),
      ).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Take a look' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/integrations/model-provider')
      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 5')).toBeInTheDocument()
      expect(
        screen.getByText(
          'View model providers here, check model credentials, and see Message Credits. Installing or changing providers requires admin permission.',
        ),
      ).toBeInTheDocument()
    } finally {
      targets.forEach((target) => target.remove())
    }
  })

  it('completes Knowledge directly when the workspace has no Knowledge walkthrough permissions', async () => {
    mockWorkspacePermissionKeys.value = ['app.create_and_management']
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio'],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(await screen.findByText('Knowledge needs permission')).toBeInTheDocument()
    expect(screen.queryByText('RESTRICTED')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'To create or manage knowledge bases, switch to a workspace where you have access or contact your admin.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Mark Knowledge needs permission complete' }),
    ).toBeDisabled()
    expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
      action: 'permission_fallback_shown',
      permission_variant: 'no_knowledge_permission',
      task_id: 'knowledge',
    })

    await user.click(screen.getByRole('button', { name: 'Got it' }))

    await expectStepByStepTourPatch({ action: 'complete_task', task_id: 'knowledge' })
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('starts the home guide against the Learn Dify target', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.home, 120, {
      height: 180,
      left: 40,
      width: 360,
    })

    try {
      renderStepByStepTourMount()

      await user.click(await screen.findByRole('button', { name: 'Show me' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/')
      expect(
        await screen.findByRole('region', { name: 'Pick a lesson to see how it works.' }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Try a Learn Dify lesson')).not.toBeInTheDocument()
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
    } finally {
      target.remove()
    }
  })

  it('uses no-create Learn Dify copy when the workspace cannot create apps', async () => {
    mockWorkspacePermissionKeys.value = []
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.home, 120, {
      height: 180,
      left: 40,
      width: 360,
    })

    try {
      renderStepByStepTourMount()

      expect(await screen.findByText('Browse Learn Dify')).toBeInTheDocument()
      expect(
        screen.getByText(
          'You can review lessons and see how Dify works here. Creating an app from a lesson requires a workspace where you have create permission, or help from an admin.',
        ),
      ).toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: 'Show me' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/')
      expect(await screen.findByRole('region', { name: 'Browse Learn Dify' })).toBeInTheDocument()
      expect(
        screen.getByText(
          'You can review lessons and see how Dify works here. Creating an app from a lesson requires a workspace where you have create permission, or help from an admin.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Got it' }))
      await expectStepByStepTourPatch({ action: 'complete_task', task_id: 'home' })
      expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    } finally {
      target.remove()
    }
  })

  it('does not render a coachmark action for externally completed home guides', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.home, 120, {
      height: 180,
      left: 40,
      width: 360,
    })

    try {
      renderStepByStepTourMount()

      await user.click(await screen.findByRole('button', { name: 'Show me' }))
      expect(await screen.findByText('Pick a lesson to see how it works.')).toBeInTheDocument()
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
    } finally {
      target.remove()
    }
  })

  it('only allows users to uncomplete tasks from the checklist status control', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home'],
      skipped: false,
    })

    renderStepByStepTourMount()

    const completeStudioButton = await screen.findByRole('button', {
      name: 'Mark Manage your apps in Studio complete',
    })
    expect(completeStudioButton).toBeDisabled()

    await user.click(completeStudioButton)

    expect(mockStepByStepTour.patchState).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'Mark Try a Learn Dify lesson incomplete' }),
    )

    await expectStepByStepTourPatch({ action: 'uncomplete_task', task_id: 'home' })
  })

  it('does not allow manually completing externally completed tasks from the checklist', async () => {
    setStepByStepTourTestState({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    })

    renderStepByStepTourMount()

    const completeHomeButton = await screen.findByRole('button', {
      name: 'Mark Try a Learn Dify lesson complete',
    })
    expect(completeHomeButton).toBeDisabled()

    await user.click(completeHomeButton)

    expect(mockStepByStepTour.patchState).not.toHaveBeenCalled()
  })

  it('walks through Integration guides and syncs the Integrations section route', async () => {
    mockPathname = '/integrations/model-provider'
    setStepByStepTourTestState({
      activeTaskId: 'integration',
      activeGuideIndex: 0,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationUpdateSettings,
    ].map((targetName, index) => createTourTarget(targetName, 96 + index * 8))

    try {
      renderStepByStepTourMount()

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      const [minimizedTourButton] = screen.getAllByRole('button', {
        name: 'Open step-by-step tour',
      })
      expect(minimizedTourButton).toBeInTheDocument()
      expect(minimizedTourButton).not.toHaveClass('z-50')
      expect(screen.getByText('1 of 6')).toBeInTheDocument()
      await waitFor(() => {
        expect(document.body.querySelector('[data-step-by-step-tour-backdrop]')).toBeInTheDocument()
      })
      expect(document.body.querySelectorAll('[data-step-by-step-tour-blocker]')).toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'guide_shown',
        guide_id: 'integration.model_provider',
        task_id: 'integration',
      })

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Tool Plugin' })).toBeInTheDocument()
      expect(screen.getByText('2 of 6')).toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/tools/built-in')
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'guide_completed',
        guide_id: 'integration.model_provider',
        task_id: 'integration',
      })

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'MCP' })).toBeInTheDocument()
      expect(screen.getByText('3 of 6')).toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/tools/mcp')

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Data Source' })).toBeInTheDocument()
      expect(screen.getByText('4 of 6')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/data-source')

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Trigger' })).toBeInTheDocument()
      expect(screen.getByText('5 of 6')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/trigger')

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Update Settings' })).toBeInTheDocument()
      expect(screen.getByText('6 of 6')).toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/tools/built-in')

      await user.click(screen.getByRole('button', { name: 'Got it' }))

      await expectStepByStepTourPatch({ action: 'complete_task', task_id: 'integration' })
      expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
      expect(
        await screen.findByRole('region', { name: 'Step-by-step Tour completed' }),
      ).toBeInTheDocument()
    } finally {
      targets.forEach((target) => target.remove())
    }
  })

  it('keeps the Integration update settings guide in the plan until its section target is rendered', async () => {
    mockPathname = '/integrations/model-provider'
    setStepByStepTourTestState({
      activeTaskId: 'integration',
      activeGuideIndex: 0,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    ].map((targetName, index) => createTourTarget(targetName, 96 + index * 8))

    try {
      renderStepByStepTourMount()

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 6')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Tool Plugin' })).toBeInTheDocument()
      expect(screen.getByText('2 of 6')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'MCP' })).toBeInTheDocument()
      expect(screen.getByText('3 of 6')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Data Source' })).toBeInTheDocument()
      expect(screen.getByText('4 of 6')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Trigger' })).toBeInTheDocument()
      expect(screen.getByText('5 of 6')).toBeInTheDocument()

      const updateSettingsTarget = createTourTarget(
        STEP_BY_STEP_TOUR_TARGETS.integrationUpdateSettings,
        144,
      )
      targets.push(updateSettingsTarget)
      mockPathname = '/integrations/tools/built-in'

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Update Settings' })).toBeInTheDocument()
      expect(screen.getByText('6 of 6')).toBeInTheDocument()
    } finally {
      targets.forEach((target) => target.remove())
    }
  })

  it('skips the optional Integration update settings guide when plugin preferences permission is unavailable', async () => {
    mockPathname = '/integrations/model-provider'
    mockWorkspacePermissionKeys.value = [
      'app.create_and_management',
      'dataset.create_and_management',
      'dataset.external.connect',
      'plugin.model_config',
      'tool.manage',
      'mcp.manage',
      'api_extension.manage',
    ]
    setStepByStepTourTestState({
      activeTaskId: 'integration',
      activeGuideIndex: 0,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    ].map((targetName, index) => createTourTarget(targetName, 96 + index * 8))

    try {
      renderStepByStepTourMount()

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 5')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Tool Plugin' })).toBeInTheDocument()
      expect(screen.getByText('2 of 5')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'MCP' })).toBeInTheDocument()
      expect(screen.getByText('3 of 5')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Data Source' })).toBeInTheDocument()
      expect(screen.getByText('4 of 5')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Trigger' })).toBeInTheDocument()
      expect(screen.getByText('5 of 5')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))

      await expectStepByStepTourPatch({ action: 'complete_task', task_id: 'integration' })
      expect(
        await screen.findByRole('region', { name: 'Step-by-step Tour completed' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Update Settings' })).not.toBeInTheDocument()
    } finally {
      targets.forEach((target) => target.remove())
    }
  })

  it('skips the optional Learn Dify guide when the Studio empty section is not rendered', async () => {
    mockPathname = '/apps'
    setStepByStepTourTestState({
      activeTaskId: 'studio',
      activeGuideIndex: 2,
      activeGuideGroup: 'studioEmpty',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    })
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate, 120),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyBlank, 210),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL, 300),
    ]

    try {
      renderStepByStepTourMount()

      expect(await screen.findByRole('region', { name: 'Import a DSL file' })).toBeInTheDocument()
      expect(screen.getByText('3 of 3')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))

      await expectStepByStepTourPatch({ action: 'complete_task', task_id: 'studio' })
    } finally {
      targets.forEach((target) => target.remove())
    }
  })

  it('skips the optional app card action guide when no app card action target is rendered', async () => {
    mockPathname = '/apps'
    setStepByStepTourTestState({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    })
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72)
    const highlightPart = createTourHighlightPart(
      STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu,
      {
        height: 184,
        left: 1088,
        top: 120,
        width: 280,
      },
    )

    try {
      renderStepByStepTourMount()

      expect(await screen.findByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Got it' }))
      await expectStepByStepTourPatch({ action: 'complete_task', task_id: 'studio' })
    } finally {
      highlightPart.remove()
      target.remove()
    }
  })

  it('skips the active walkthrough without completing the task', async () => {
    mockPathname = '/integrations/model-provider'
    setStepByStepTourTestState({
      activeTaskId: 'integration',
      activeGuideIndex: 1,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav)

    try {
      renderStepByStepTourMount()

      expect(await screen.findByRole('region', { name: 'Tool Plugin' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip tour' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'guide_shown',
        guide_id: 'integration.tool_plugin',
        task_id: 'integration',
      })

      await user.click(screen.getByRole('button', { name: 'Skip tour' }))

      expect(
        mockStepByStepTour.patchState.mock.calls.map(([variables]) => variables.body),
      ).not.toContainEqual(expect.objectContaining({ action: 'complete_task' }))
      expect(localStorage.getItem(STEP_BY_STEP_TOUR_SHELL_MODE_STORAGE_KEY)).toBe('expanded')
      expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'Step-by-step Tour recovery tip' }),
      ).not.toBeInTheDocument()
      expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
        action: 'guide_skipped',
        guide_id: 'integration.tool_plugin',
        task_id: 'integration',
      })
    } finally {
      target.remove()
    }
  })

  it('keeps the minimized tour control visible when an active guide target is unavailable', async () => {
    mockPathname = '/app/test-app/overview'
    setStepByStepTourTestState({
      activeTaskId: 'integration',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    })

    renderStepByStepTourMount()

    expect(
      await screen.findAllByRole('button', { name: 'Open step-by-step tour' }),
    ).not.toHaveLength(0)
  })
})
