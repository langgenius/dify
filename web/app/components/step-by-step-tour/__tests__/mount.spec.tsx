import type { AppContextValue } from '@/context/app-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { STEP_BY_STEP_TOUR_STORAGE_KEY } from '../constants'
import StepByStepTourMount from '../mount'
import { STEP_BY_STEP_TOUR_TARGETS } from '../target-registry'
import { useStepByStepTourTargetRect } from '../use-target-rect'

type WorkspaceRole = NonNullable<AppContextValue['currentWorkspace']>['role']

const mockRouterPush = vi.fn()
let mockPathname = '/apps'
const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: [
    'app.create_and_management',
    'dataset.create_and_management',
    'dataset.external.connect',
    'plugin.model_config',
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

const setViewportSize = ({
  height,
  width,
}: {
  height: number
  width: number
}) => {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })
}

vi.mock('@/config', () => ({
  IS_CLOUD_EDITION: true,
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return {
    ...actual,
    ...createReactI18nextMock({
      'common.stepByStepTour.title': 'Get to know Dify',
      'common.stepByStepTour.duration': 'A quick tour — about 5 minutes',
      'common.stepByStepTour.guides.integration.dataSource.description': 'Connect external data sources so Knowledge bases can pull from them.',
      'common.stepByStepTour.guides.integration.dataSource.title': 'Data Source',
      'common.stepByStepTour.guides.integration.mcp.description': 'Connect MCP servers when your apps need access to external tools and services through MCP.',
      'common.stepByStepTour.guides.integration.mcp.title': 'MCP',
      'common.stepByStepTour.guides.integration.modelProvider.description': 'Manage or install model providers here, set up model credentials, and check your Message Credits.',
      'common.stepByStepTour.guides.integration.modelProvider.title': 'Model Provider',
      'common.stepByStepTour.guides.integration.limitedAccess.dataSource.description': 'Connect data sources here so Knowledge can bring in content from Drive, Notion, GitHub, Firecrawl, and more. Setup may require admin access.',
      'common.stepByStepTour.guides.integration.limitedAccess.mcp.description': 'View connected MCP servers that expose external tools and services to apps. Adding or editing servers requires the right workspace permission.',
      'common.stepByStepTour.guides.integration.limitedAccess.modelProvider.description': 'View model providers here, check model credentials, and see Message Credits. Installing or changing providers requires admin permission.',
      'common.stepByStepTour.guides.integration.limitedAccess.toolPlugin.description': 'Browse installed tools and marketplace plugins that apps can call during execution. Ask an admin if you need to install or configure one.',
      'common.stepByStepTour.guides.integration.limitedAccess.trigger.description': 'View triggers that turn third-party events into app inputs. Creating or managing triggers requires permission from your Workspace Owner or Admin.',
      'common.stepByStepTour.guides.integration.toolPlugin.description': 'Manage built-in tools and marketplace plugins that apps can call during execution.',
      'common.stepByStepTour.guides.integration.toolPlugin.title': 'Tool Plugin',
      'common.stepByStepTour.guides.integration.trigger.description': 'Convert third-party events into inputs your apps can act on.',
      'common.stepByStepTour.guides.integration.trigger.title': 'Trigger',
      'common.stepByStepTour.guides.integration.updateSettings.description': 'Configure how integrations update automatically, including the update mode, scheduled time, and which integrations are included.',
      'common.stepByStepTour.guides.integration.updateSettings.title': 'Update Settings',
      'common.stepByStepTour.guides.home.create.description': 'Click here to make it yours',
      'common.stepByStepTour.guides.home.noCreate.description': 'You can review lessons and see how Dify works here. Creating an app from a lesson requires a workspace where you have create permission, or help from an admin.',
      'common.stepByStepTour.guides.home.noCreate.title': 'Browse lessons in Learn Dify',
      'common.stepByStepTour.guides.knowledge.empty.connect.description': 'Already have a knowledge base elsewhere? Connect it via API — no data migration needed.',
      'common.stepByStepTour.guides.knowledge.empty.connect.title': 'Connect to an external knowledge base',
      'common.stepByStepTour.guides.knowledge.empty.create.description': 'Fastest way to get going. Upload documents and Dify handles chunking, indexing, and embedding for you. You can switch to custom anytime.',
      'common.stepByStepTour.guides.knowledge.empty.create.title': 'Create a ready-to-use knowledge base',
      'common.stepByStepTour.guides.knowledge.empty.pipeline.description': 'Define your own chunking, cleanup, and indexing flow when you need finer control over how documents become searchable.',
      'common.stepByStepTour.guides.knowledge.empty.pipeline.title': 'Build a custom knowledge base',
      'common.stepByStepTour.guides.knowledge.withDatasets.create.description': 'Click Create to set up a new Knowledge base — start from a ready-to-use template, build a custom one from your own documents, or connect to an external knowledge base.',
      'common.stepByStepTour.guides.knowledge.withDatasets.create.title': 'Create a new knowledge here',
      'common.stepByStepTour.guides.knowledge.withDatasets.manage.description': 'Click a card to open the Knowledge base and manage its documents. Hover a card and click ··· in the corner to edit or delete it.',
      'common.stepByStepTour.guides.knowledge.withDatasets.manage.title': 'Open or manage this knowledge',
      'common.stepByStepTour.guides.primaryActionLabel': 'Got it',
      'common.stepByStepTour.guides.studio.empty.blank.description': 'Start from an empty canvas when you already know what to build.',
      'common.stepByStepTour.guides.studio.empty.blank.title': 'Create from blank',
      'common.stepByStepTour.guides.studio.empty.dsl.description': 'Got a Dify DSL file? Import it here to restore an app you have shared or backed up.',
      'common.stepByStepTour.guides.studio.empty.dsl.title': 'Import a DSL file',
      'common.stepByStepTour.guides.studio.empty.learnDify.description': 'New to Dify? Walk through a guided lesson first.',
      'common.stepByStepTour.guides.studio.empty.learnDify.title': 'Or start with Learn Dify',
      'common.stepByStepTour.guides.studio.empty.template.description': 'Browse Dify templates and pick one that matches what you want to build.',
      'common.stepByStepTour.guides.studio.empty.template.title': 'Create from a template',
      'common.stepByStepTour.guides.studio.noCreate.empty.description': 'You can view apps in this workspace, but there are no apps here yet. To create or edit apps, switch workspaces or ask your Workspace Owner or Admin for access.',
      'common.stepByStepTour.guides.studio.noCreate.empty.title': 'No apps to view yet',
      'common.stepByStepTour.guides.studio.noCreate.withApps.description': 'You can browse and open apps in this workspace, but creating or editing apps requires permission. Switch to a workspace where you have access, or contact your Workspace Owner or Admin.',
      'common.stepByStepTour.guides.studio.noCreate.withApps.title': 'Studio is view-only for you',
      'common.stepByStepTour.guides.studio.withApps.create.description': 'Use Create to add a new app — pick from a template, start from blank, or import a DSL file.',
      'common.stepByStepTour.guides.studio.withApps.create.title': 'Create a new app',
      'common.stepByStepTour.guides.studio.withApps.manage.description': 'Tap any app to open its orchestration page — edit prompts, models, and logic, or manage its settings from there.',
      'common.stepByStepTour.guides.studio.withApps.manage.title': 'Open and manage each app',
      'common.stepByStepTour.skip': 'Skip',
      'common.stepByStepTour.skipRecovery.dismiss': 'Got it',
      'common.stepByStepTour.skipRecovery.label': 'Step-by-step Tour recovery tip',
      'common.stepByStepTour.skipRecovery.message': 'Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.',
      'common.stepByStepTour.completion.description': 'You’ve seen the essentials. Time to build something.',
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
      'common.stepByStepTour.tasks.home.description': 'Open a hands-on lesson from Learn Dify to see Dify in action.',
      'common.stepByStepTour.tasks.home.noCreate.title': 'Browse Learn Dify',
      'common.stepByStepTour.tasks.home.noCreate.description': 'You can review lessons here, but creating from a lesson requires additional permission.',
      'common.stepByStepTour.tasks.home.primaryActionLabel': 'Show me',
      'common.stepByStepTour.tasks.studio.title': 'Manage your apps in Studio',
      'common.stepByStepTour.tasks.studio.description': 'All your apps live in Studio — edit, organize, and publish them here.',
      'common.stepByStepTour.tasks.studio.noCreate.title': 'Find your apps in Studio',
      'common.stepByStepTour.tasks.studio.noCreate.description': 'You can view apps in this workspace. To create or edit apps, switch workspaces or ask your Workspace Owner or Admin for access.',
      'common.stepByStepTour.tasks.studio.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.knowledge.title': 'Add your own data',
      'common.stepByStepTour.tasks.knowledge.description': 'Build a knowledge base so your apps answer from your documents.',
      'common.stepByStepTour.tasks.knowledge.noPermission.title': 'Knowledge needs permission',
      'common.stepByStepTour.tasks.knowledge.noPermission.description': 'To create or manage knowledge bases, switch to a workspace where you have access or contact your Workspace Owner or Admin.',
      'common.stepByStepTour.tasks.knowledge.noPermission.primaryActionLabel': 'Got it',
      'common.stepByStepTour.tasks.knowledge.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.integration.title': 'Explore integrations',
      'common.stepByStepTour.tasks.integration.description': 'Models, tools, data sources & more — explore what you can connect.',
      'common.stepByStepTour.tasks.integration.noPermission.title': 'Explore Integrations',
      'common.stepByStepTour.tasks.integration.noPermission.description': 'Browse models, tools, and data sources, and see how they are managed.',
      'common.stepByStepTour.tasks.integration.primaryActionLabel': 'Take a look',
    }),
  }
})

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
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
  } satisfies Partial<AppContextValue>),
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

const createTourTarget = (targetName: string, top = 114, rect?: Partial<TestRect>) => createTourElement(
  'stepByStepTourTarget',
  targetName,
  {
    height: 64,
    left: 472,
    top,
    width: 1012,
    ...rect,
  },
)

const createTourHighlightPart = (targetName: string, rect: TestRect) => createTourElement(
  'stepByStepTourHighlightPart',
  targetName,
  rect,
)

function TargetRectProbe({
  highlightPartSelectors,
  targetElement,
}: {
  highlightPartSelectors: string[]
  targetElement: HTMLElement
}) {
  const targetRects = useStepByStepTourTargetRect(targetElement, highlightPartSelectors)

  return (
    <div
      data-highlight-parts-ready={targetRects.highlightPartsReady}
      data-rect-settled={targetRects.rectSettled}
    />
  )
}

describe('StepByStepTourMount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = [
      'app.create_and_management',
      'dataset.create_and_management',
      'dataset.external.connect',
      'plugin.model_config',
      'tool.manage',
      'mcp.manage',
      'api_extension.manage',
    ]
    mockIsCurrentWorkspaceManager.value = true
    mockCurrentWorkspaceRole.value = 'owner'
    mockPathname = '/apps'
    localStorage.clear()
    setViewportSize({ height: 768, width: 1024 })
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
  })

  it('captures the first workspace and renders the floating checklist by default', async () => {
    render(<StepByStepTourMount />)

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.firstWorkspaceId).toBe('workspace-1')
    })
  })

  it('hides the checklist and shows a dismissible recovery hint after Skip', async () => {
    render(<StepByStepTourMount />)

    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('region', { name: 'Step-by-step Tour recovery tip' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Step-by-step Tour recovery tip' })).toHaveClass('bg-state-accent-hover', 'border-state-accent-hover-alt')
    expect(screen.getByText('Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.')).toBeInTheDocument()

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.skipped).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    expect(screen.queryByRole('region', { name: 'Step-by-step Tour recovery tip' })).not.toBeInTheDocument()
  })

  it('shows a dismissible completion prompt at the bottom of the checklist after all tasks are complete', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge', 'integration'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Step-by-step Tour completed' })).toBeInTheDocument()
    expect(screen.getByText('You’re all set')).toBeInTheDocument()
    expect(screen.getByText('You’ve seen the essentials. Time to build something.')).toBeInTheDocument()

    const dismissButton = screen.getByRole('button', { name: 'Dismiss' })
    expect(dismissButton).toHaveFocus()

    fireEvent.click(dismissButton)

    expect(screen.queryByRole('region', { name: 'Step-by-step Tour completed' })).not.toBeInTheDocument()
    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.skipped).toBe(true)
      expect(state.manuallyEnabledWorkspaceIds).toEqual([])
    })
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
  })

  it('keeps the tour hidden after completion dismiss closes the tour', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge', 'integration'],
      skipped: true,
    }))

    render(<StepByStepTourMount />)

    expect(screen.queryByRole('region', { name: 'Step-by-step Tour completed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
  })

  it('renders the floating checklist when the current workspace is manually enabled', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    expect(screen.getByText('A quick tour — about 5 minutes')).toBeInTheDocument()
  })

  it('renders the expanded checklist in the shared popover layer', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    const checklist = await screen.findByRole('region', { name: 'Get to know Dify' })
    const popoverPopup = checklist.parentElement
    const popoverPositioner = popoverPopup?.parentElement

    expect(checklist.closest('[data-base-ui-portal]')).toBeInTheDocument()
    expect(popoverPositioner).toHaveClass('z-50')
    expect(popoverPositioner).toHaveAttribute('data-side', 'top')
    expect(popoverPositioner).toHaveAttribute('data-align', 'start')
    expect(popoverPopup).toHaveClass('max-h-[calc(100vh-16px)]', 'overflow-y-auto')
  })

  it('starts the integration guide instead of immediately completing the task', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    fireEvent.click(await screen.findByRole('button', { name: 'Take a look' }))

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.activeTaskId).toBe('integration')
      expect(state.activeGuideIndexes).toHaveLength(6)
      expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
      expect(state.minimized).toBe(true)
    })
    expect(mockRouterPush).toHaveBeenCalledWith('/integrations/model-provider')
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
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    ].map((targetName, index) => createTourTarget(targetName, 80 + index * 8, {
      height: 40,
      left: 0,
      width: 200,
    }))

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByText('Browse models, tools, and data sources, and see how they are managed.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Take a look' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/integrations/model-provider')
      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 5')).toBeInTheDocument()
      expect(screen.getByText('View model providers here, check model credentials, and see Message Credits. Installing or changing providers requires admin permission.')).toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-coachmark]')).toHaveStyle({
        left: '8px',
        top: '140px',
      })
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBe('integration')
        expect(state.activeGuideGroup).toBe('integrationLimitedAccess')
        expect(state.activeGuideIndexes).toEqual([0, 1, 2, 3, 4])
        expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
      })
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('uses limited access integration guides for dataset operators', async () => {
    mockIsCurrentWorkspaceManager.value = false
    mockCurrentWorkspaceRole.value = 'dataset_operator'
    mockWorkspacePermissionKeys.value = [
      'plugin.install',
      'dataset.create_and_management',
      'dataset.external.connect',
    ]
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    ].map((targetName, index) => createTourTarget(targetName, 80 + index * 8))

    try {
      render(<StepByStepTourMount />)

      fireEvent.click(await screen.findByRole('button', { name: 'Take a look' }))

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 5')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Free AI Credits to get started' })).not.toBeInTheDocument()
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('uses limited access integration guides for editors', async () => {
    mockIsCurrentWorkspaceManager.value = false
    mockCurrentWorkspaceRole.value = 'editor'
    mockWorkspacePermissionKeys.value = [
      'workspace.member.manage',
      'api_extension.manage',
      'plugin.install',
      'credential.use',
      'app_library.access',
      'app.create_and_management',
      'app.tag.manage',
      'dataset.create_and_management',
      'dataset.tag.manage',
      'dataset.external.connect',
      'snippets.create_and_modify',
      'tool.manage',
    ]
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
    ].map((targetName, index) => createTourTarget(targetName, 96 + index * 8))

    try {
      render(<StepByStepTourMount />)

      fireEvent.click(await screen.findByRole('button', { name: 'Take a look' }))

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 5')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Free AI Credits to get started' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Add your own MCP Server' })).not.toBeInTheDocument()

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBe('integration')
        expect(state.activeGuideGroup).toBe('integrationLimitedAccess')
        expect(state.activeGuideIndexes).toHaveLength(5)
      })
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('normalizes an already active integration guide to limited access when permissions are missing', async () => {
    mockPathname = '/integrations/model-provider'
    mockIsCurrentWorkspaceManager.value = false
    mockCurrentWorkspaceRole.value = 'normal'
    mockWorkspacePermissionKeys.value = [
      'api_extension.manage',
      'plugin.install',
      'credential.use',
      'app_library.access',
    ]
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      activeGuideIndex: 0,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const limitedTarget = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav, 80, {
      height: 420,
      left: 0,
      width: 200,
    })

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      expect(screen.getByText('1 of 5')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Free AI Credits to get started' })).not.toBeInTheDocument()
    }
    finally {
      limitedTarget.remove()
    }
  })

  it('completes Knowledge directly when the workspace has no Knowledge walkthrough permissions', async () => {
    mockWorkspacePermissionKeys.value = ['app.create_and_management']
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByText('Knowledge needs permission')).toBeInTheDocument()
    expect(screen.queryByText('RESTRICTED')).not.toBeInTheDocument()
    expect(screen.getByText('To create or manage knowledge bases, switch to a workspace where you have access or contact your Workspace Owner or Admin.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Knowledge needs permission complete' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.activeTaskId).toBeUndefined()
      expect(state.activeGuideGroup).toBeUndefined()
      expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
      expect(state.minimized).toBe(false)
    })
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('starts Studio for no-create users and waits for the app list to choose the readonly guide', async () => {
    mockWorkspacePermissionKeys.value = []
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByText('Find your apps in Studio')).toBeInTheDocument()
    expect(screen.getByText('You can view apps in this workspace. To create or edit apps, switch workspaces or ask your Workspace Owner or Admin for access.')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Take a look' })[0]!)

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.activeTaskId).toBe('studio')
      expect(state.activeGuideIndex).toBe(0)
      expect(state.activeGuideGroup).toBeUndefined()
      expect(state.activeGuideIndexes).toBeUndefined()
      expect(state.completedTaskIds).toEqual(['home'])
      expect(state.minimized).toBe(true)
    })
    expect(mockRouterPush).toHaveBeenCalledWith('/apps')
  })

  it('does not render Learn more for the Knowledge task row', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'integration'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByRole('button', { name: 'Take a look' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
  })

  it('starts the home guide against the Learn Dify target', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.home, 120, {
      height: 180,
      left: 40,
      width: 360,
    })

    try {
      render(<StepByStepTourMount />)

      fireEvent.click(await screen.findByRole('button', { name: 'Show me' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/')
      expect(await screen.findByRole('region', { name: 'Open a hands-on lesson from Learn Dify to see Dify in action.' })).toBeInTheDocument()
      expect(screen.queryByText('Try a Learn Dify lesson')).not.toBeInTheDocument()
      expect(screen.queryByText('1 of 2')).not.toBeInTheDocument()
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBe('home')
        expect(state.completedTaskIds).toEqual([])
        expect(state.minimized).toBe(true)
      })
    }
    finally {
      target.remove()
    }
  })

  it('uses no-create Learn Dify copy when the workspace cannot create apps', async () => {
    mockWorkspacePermissionKeys.value = []
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.home, 120, {
      height: 180,
      left: 40,
      width: 360,
    })

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByText('Browse Learn Dify')).toBeInTheDocument()
      expect(screen.getByText('You can review lessons here, but creating from a lesson requires additional permission.')).toBeInTheDocument()
      fireEvent.click(await screen.findByRole('button', { name: 'Show me' }))

      expect(mockRouterPush).toHaveBeenCalledWith('/')
      expect(await screen.findByRole('region', { name: 'Browse lessons in Learn Dify' })).toBeInTheDocument()
      expect(screen.getByText('You can review lessons and see how Dify works here. Creating an app from a lesson requires a workspace where you have create permission, or help from an admin.')).toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBe('home')
        expect(state.activeGuideGroup).toBe('homeNoCreate')
        expect(state.activeGuideIndex).toBe(0)
        expect(state.completedTaskIds).toEqual([])
        expect(state.minimized).toBe(true)
      })

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideGroup).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home'])
        expect(state.minimized).toBe(false)
      })
    }
    finally {
      target.remove()
    }
  })

  it('does not render a coachmark action for externally completed home guides', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.home, 120, {
      height: 180,
      left: 40,
      width: 360,
    })

    try {
      render(<StepByStepTourMount />)

      fireEvent.click(await screen.findByRole('button', { name: 'Show me' }))
      expect(await screen.findByText('Open a hands-on lesson from Learn Dify to see Dify in action.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show me' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(document.body.querySelectorAll('[data-step-by-step-tour-blocker]')).toHaveLength(4)

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBe('home')
        expect(state.activeGuideIndex).toBe(0)
        expect(state.completedTaskIds).toEqual([])
      })
    }
    finally {
      target.remove()
    }
  })

  it('renders the coachmark overlay at the body level so dialogs do not cover it', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'home',
      activeGuideIndex: 1,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: [],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.homeTryAppCreate, 240, {
      height: 40,
      left: 980,
      width: 320,
    })

    try {
      render(<StepByStepTourMount />)

      const coachmark = await screen.findByText('Click here to make it yours')
      const coachmarkOverlay = coachmark.closest('[data-step-by-step-tour-coachmark]')
      const coachmarkRegion = screen.getByRole('region', { name: 'Click here to make it yours' })
      const highlightOverlay = document.body.querySelector('[data-step-by-step-tour-highlight]')
      const backdropOverlay = document.body.querySelector('[data-step-by-step-tour-backdrop]')

      expect(coachmarkOverlay?.parentElement).toBe(document.body)
      expect(coachmarkRegion).toHaveClass('bg-state-accent-hover', 'border-state-accent-hover-alt')
      expect(highlightOverlay?.parentElement).toBe(document.body)
      expect(backdropOverlay?.parentElement).toBe(document.body)
    }
    finally {
      target.remove()
    }
  })

  it('only allows users to uncomplete tasks from the checklist status control', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    const completeStudioButton = await screen.findByRole('button', { name: 'Mark Manage your apps in Studio complete' })
    expect(completeStudioButton).toBeDisabled()

    fireEvent.click(completeStudioButton)

    expect(JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!).completedTaskIds).toEqual(['home'])

    fireEvent.click(screen.getByRole('button', { name: 'Mark Try a Learn Dify lesson incomplete' }))

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.completedTaskIds).toEqual([])
    })
  })

  it('does not allow manually completing externally completed tasks from the checklist', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: [],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    const completeHomeButton = await screen.findByRole('button', { name: 'Mark Try a Learn Dify lesson complete' })
    expect(completeHomeButton).toBeDisabled()

    fireEvent.click(completeHomeButton)

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.completedTaskIds).toEqual([])
    })
  })

  it('walks through Integration guides and syncs the Integrations section route', async () => {
    mockPathname = '/integrations/model-provider'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      activeGuideIndex: 0,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const targets = [
      STEP_BY_STEP_TOUR_TARGETS.integrationModelProviderNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationMcpNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationDataSourceNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationTriggerNav,
      STEP_BY_STEP_TOUR_TARGETS.integrationUpdateSettings,
    ].map((targetName, index) => createTourTarget(targetName, 96 + index * 8))

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Model Provider' })).toBeInTheDocument()
      const minimizedTourButton = screen.getByRole('button', { name: 'Open step-by-step tour' })
      expect(minimizedTourButton).toBeInTheDocument()
      expect(minimizedTourButton).not.toHaveClass('z-50')
      expect(screen.getByText('1 of 6')).toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-backdrop]')).toBeInTheDocument()
      expect(document.body.querySelectorAll('[data-step-by-step-tour-blocker]')).toHaveLength(0)
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Tool Plugin' })).toBeInTheDocument()
      expect(screen.getByText('2 of 6')).toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/tools/built-in')

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'MCP' })).toBeInTheDocument()
      expect(screen.getByText('3 of 6')).toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/tools/mcp')

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Data Source' })).toBeInTheDocument()
      expect(screen.getByText('4 of 6')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/data-source')

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Trigger' })).toBeInTheDocument()
      expect(screen.getByText('5 of 6')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/trigger')

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Update Settings' })).toBeInTheDocument()
      expect(screen.getByText('6 of 6')).toBeInTheDocument()
      expect(mockRouterPush).toHaveBeenLastCalledWith('/integrations/tools/built-in')

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideIndexes).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge', 'integration'])
        expect(state.minimized).toBe(false)
      })
      expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Step-by-step Tour completed' })).toBeInTheDocument()
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('highlights the union of an active target and its rendered highlight parts', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72, {
      height: 40,
      left: 1264,
      width: 104,
    })
    const highlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu, {
      height: 184,
      left: 1088,
      top: 120,
      width: 280,
    })

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      const highlight = document.body.querySelector('[data-step-by-step-tour-highlight]') as HTMLElement
      const coachmark = document.body.querySelector('[data-step-by-step-tour-coachmark]') as HTMLElement

      expect(highlight).toHaveStyle({
        height: '240px',
        left: '1084px',
        top: '68px',
        width: '288px',
      })
      expect(coachmark).toHaveStyle({ left: '664px', top: '324px' })
    }
    finally {
      target.remove()
      highlightPart.remove()
    }
  })

  it('waits for declared highlight parts before rendering a union highlight', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72, {
      height: 40,
      left: 1264,
      width: 104,
    })
    let highlightPart: HTMLElement | undefined

    try {
      render(<StepByStepTourMount />)

      expect(document.body.querySelector('[data-step-by-step-tour-backdrop]')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Create a new app' })).not.toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-highlight]')).not.toBeInTheDocument()

      highlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu, {
        height: 184,
        left: 1088,
        top: 120,
        width: 280,
      })

      expect(await screen.findByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      const highlight = document.body.querySelector('[data-step-by-step-tour-highlight]') as HTMLElement
      expect(highlight).toHaveStyle({
        height: '240px',
        left: '1084px',
        top: '68px',
        width: '288px',
      })
    }
    finally {
      highlightPart?.remove()
      target.remove()
    }
  })

  it('waits for missing highlight parts without scheduling a frame loop', () => {
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72, {
      height: 40,
      left: 1264,
      width: 104,
    })

    try {
      render(
        <TargetRectProbe
          targetElement={target}
          highlightPartSelectors={[
            `[data-step-by-step-tour-highlight-part="${STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu}"]`,
          ]}
        />,
      )

      expect(document.body.querySelector('[data-highlight-parts-ready="false"]')).toBeInTheDocument()
      expect(document.body.querySelector('[data-rect-settled="false"]')).toBeInTheDocument()
      expect(requestAnimationFrameSpy).not.toHaveBeenCalled()
    }
    finally {
      requestAnimationFrameSpy.mockRestore()
      target.remove()
    }
  })

  it('observes only the primary target for resize while measuring highlight parts', () => {
    const observedResizeElements: Element[] = []
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}

      observe(element: Element) {
        observedResizeElements.push(element)
      }

      unobserve() {}

      disconnect() {}
    } as typeof ResizeObserver
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72, {
      height: 40,
      left: 1264,
      width: 104,
    })
    const highlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu, {
      height: 184,
      left: 1088,
      top: 120,
      width: 280,
    })

    try {
      render(
        <TargetRectProbe
          targetElement={target}
          highlightPartSelectors={[
            `[data-step-by-step-tour-highlight-part="${STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu}"]`,
          ]}
        />,
      )

      expect(observedResizeElements).toEqual([target])
      expect(document.body.querySelector('[data-highlight-parts-ready="true"]')).toBeInTheDocument()
    }
    finally {
      highlightPart.remove()
      target.remove()
    }
  })

  it('updates the highlight union when a portalled highlight part positioner moves', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 1,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard, 44, {
      height: 236,
      left: 36,
      width: 320,
    })
    const positioner = document.createElement('div')
    let menuRect = {
      height: 192,
      left: 140,
      top: 92,
      width: 216,
    }
    const highlightPart = document.createElement('div')
    highlightPart.dataset.stepByStepTourHighlightPart = STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu
    highlightPart.getBoundingClientRect = () => ({
      bottom: menuRect.top + menuRect.height,
      height: menuRect.height,
      left: menuRect.left,
      right: menuRect.left + menuRect.width,
      top: menuRect.top,
      width: menuRect.width,
      x: menuRect.left,
      y: menuRect.top,
      toJSON: () => ({}),
    })
    positioner.appendChild(highlightPart)
    document.body.appendChild(positioner)

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Open and manage each app' })).toBeInTheDocument()
      const highlight = document.body.querySelector('[data-step-by-step-tour-highlight]') as HTMLElement
      expect(highlight).toHaveStyle({
        height: '248px',
        left: '32px',
        top: '40px',
        width: '328px',
      })

      menuRect = {
        height: 192,
        left: 140,
        top: 92,
        width: 244,
      }
      positioner.setAttribute('style', 'transform: translate3d(0, 0, 0);')

      await waitFor(() => {
        expect(document.body.querySelector('[data-step-by-step-tour-highlight]')).toHaveStyle({
          width: '356px',
        })
      })
    }
    finally {
      target.remove()
      positioner.remove()
    }
  })

  it('walks through the Studio empty state guides before completing Studio', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioEmpty',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate, 120),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyBlank, 210),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL, 300),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyLearnDify, 390),
    ]

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create from a template' })).toBeInTheDocument()
      expect(screen.getByText('1 of 4')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Create from blank' })).toBeInTheDocument()
      expect(screen.getByText('2 of 4')).toBeInTheDocument()
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeGuideIndex).toBe(1)
        expect(state.completedTaskIds).toEqual(['home'])
      })

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Import a DSL file' })).toBeInTheDocument()
      expect(screen.getByText('3 of 4')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Or start with Learn Dify' })).toBeInTheDocument()
      expect(screen.getByText('4 of 4')).toBeInTheDocument()
      await waitFor(() => {
        expect(document.body.querySelector('[data-step-by-step-tour-coachmark]')).toHaveStyle({ top: '212px' })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideIndex).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio'])
        expect(state.minimized).toBe(false)
      })
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('walks through the Knowledge empty state guides before completing Knowledge', async () => {
    mockPathname = '/datasets'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'knowledge',
      activeGuideIndex: 0,
      activeGuideGroup: 'knowledgeEmpty',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio'],
      skipped: false,
    }))
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyCreate, 120),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyPipeline, 210),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.knowledgeEmptyConnect, 300),
    ]

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create a ready-to-use knowledge base' })).toBeInTheDocument()
      expect(screen.getByText('1 of 3')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Build a custom knowledge base' })).toBeInTheDocument()
      expect(screen.getByText('2 of 3')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Connect to an external knowledge base' })).toBeInTheDocument()
      expect(screen.getByText('3 of 3')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideIndex).toBeUndefined()
        expect(state.activeGuideGroup).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
        expect(state.minimized).toBe(false)
      })
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('walks through the Knowledge with-datasets guides before completing Knowledge', async () => {
    mockPathname = '/datasets'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'knowledge',
      activeGuideIndex: 0,
      activeGuideGroup: 'knowledgeWithDatasets',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio'],
      skipped: false,
    }))
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate, 72, {
        height: 40,
        left: 1264,
        width: 104,
      }),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard, 164, {
        height: 166,
        left: 36,
        width: 320,
      }),
    ]
    const highlightParts = [
      createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu, {
        height: 136,
        left: 1088,
        top: 120,
        width: 320,
      }),
      createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu, {
        height: 96,
        left: 180,
        top: 212,
        width: 186,
      }),
    ]

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create a new knowledge here' })).toBeInTheDocument()
      expect(screen.getByText('1 of 2')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Open or manage this knowledge' })).toBeInTheDocument()
      expect(screen.getByText('2 of 2')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideIndex).toBeUndefined()
        expect(state.activeGuideGroup).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
        expect(state.minimized).toBe(false)
      })
    }
    finally {
      targets.forEach(target => target.remove())
      highlightParts.forEach(highlightPart => highlightPart.remove())
    }
  })

  it('skips the optional Learn Dify guide when the Studio empty section is not rendered', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 2,
      activeGuideGroup: 'studioEmpty',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyTemplate, 120),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyBlank, 210),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioEmptyDSL, 300),
    ]

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Import a DSL file' })).toBeInTheDocument()
      expect(screen.getByText('3 of 3')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio'])
      })
    }
    finally {
      targets.forEach(target => target.remove())
    }
  })

  it('walks through the Studio with-apps guides before completing Studio', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard, 164),
    ]
    const highlightParts = [
      createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu, {
        height: 184,
        left: 1088,
        top: 120,
        width: 280,
      }),
      createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu, {
        height: 192,
        left: 672,
        top: 212,
        width: 216,
      }),
    ]

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      expect(screen.getByText('1 of 2')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(await screen.findByRole('region', { name: 'Open and manage each app' })).toBeInTheDocument()
      expect(screen.getByText('2 of 2')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideIndex).toBeUndefined()
        expect(state.activeGuideGroup).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio'])
        expect(state.minimized).toBe(false)
      })
    }
    finally {
      targets.forEach(target => target.remove())
      highlightParts.forEach(highlightPart => highlightPart.remove())
    }
  })

  it('uses the Studio no-create with-apps guide count for readonly users', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioNoCreateWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppCard, 164)
    const highlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioNoCreateFirstAppRowCard, {
      height: 164,
      left: 36,
      top: 56,
      width: 1304,
    })

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Studio is view-only for you' })).toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()
      expect(screen.queryByText('2 of 4')).not.toBeInTheDocument()
    }
    finally {
      highlightPart.remove()
      target.remove()
    }
  })

  it('uses the Studio no-create empty guide count for readonly users without apps', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioNoCreateEmpty',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioNoCreateEmpty, 164)

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'No apps to view yet' })).toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()
      expect(screen.queryByText('2 of 4')).not.toBeInTheDocument()
    }
    finally {
      target.remove()
    }
  })

  it('keeps the previous stable highlight while the next Studio with-apps guide settles', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const targets = [
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72, {
        height: 40,
        left: 1264,
        width: 104,
      }),
      createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCard, 164, {
        height: 236,
        left: 36,
        width: 320,
      }),
    ]
    const createHighlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu, {
      height: 184,
      left: 1088,
      top: 120,
      width: 280,
    })
    let appCardHighlightPart: HTMLElement | undefined

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      const highlight = document.body.querySelector('[data-step-by-step-tour-highlight]') as HTMLElement
      expect(highlight).toHaveStyle({
        height: '240px',
        left: '1084px',
        top: '68px',
        width: '288px',
      })

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

      expect(screen.getByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-backdrop]')).toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-highlight]')).toHaveStyle({
        height: '240px',
        left: '1084px',
        top: '68px',
        width: '288px',
      })

      appCardHighlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu, {
        height: 192,
        left: 180,
        top: 212,
        width: 216,
      })

      expect(await screen.findByRole('region', { name: 'Open and manage each app' })).toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-highlight]')).toHaveStyle({
        height: '248px',
        left: '32px',
        top: '160px',
        width: '368px',
      })
    }
    finally {
      appCardHighlightPart?.remove()
      createHighlightPart.remove()
      targets.forEach(target => target.remove())
    }
  })

  it('skips the optional app card action guide when no app card action target is rendered', async () => {
    mockPathname = '/apps'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'studio',
      activeGuideIndex: 0,
      activeGuideGroup: 'studioWithApps',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreate, 72)
    const highlightPart = createTourHighlightPart(STEP_BY_STEP_TOUR_TARGETS.studioWithAppsCreateMenu, {
      height: 184,
      left: 1088,
      top: 120,
      width: 280,
    })

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Create a new app' })).toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio'])
      })
    }
    finally {
      highlightPart.remove()
      target.remove()
    }
  })

  it('skips the active walkthrough without completing the task', async () => {
    mockPathname = '/integrations/model-provider'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      activeGuideIndex: 1,
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const target = createTourTarget(STEP_BY_STEP_TOUR_TARGETS.integrationToolPluginNav)

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Tool Plugin' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Learn more' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.activeGuideIndex).toBeUndefined()
        expect(state.activeGuideGroup).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
        expect(state.minimized).toBe(true)
        expect(state.skipped).toBe(false)
      })
      expect(screen.queryByRole('region', { name: 'Step-by-step Tour recovery tip' })).not.toBeInTheDocument()
    }
    finally {
      target.remove()
    }
  })

  it('keeps the minimized tour control visible when an active guide target is unavailable', async () => {
    mockPathname = '/app/test-app/overview'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByRole('button', { name: 'Open step-by-step tour' })).toBeInTheDocument()
  })

  it('keeps the tour collapsed during an active guide even if the saved widget state is expanded', async () => {
    mockPathname = '/integrations/model-provider'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    expect(await screen.findByRole('button', { name: 'Open step-by-step tour' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Get to know Dify' })).not.toBeInTheDocument()
  })
})
