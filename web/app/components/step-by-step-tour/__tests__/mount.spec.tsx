import type { AppContextValue } from '@/context/app-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { STEP_BY_STEP_TOUR_STORAGE_KEY } from '../constants'
import StepByStepTourMount from '../mount'
import { STEP_BY_STEP_TOUR_TARGETS } from '../target-registry'
import { useStepByStepTourTargetRect } from '../use-target-rect'

const mockRouterPush = vi.fn()
let mockPathname = '/apps'

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
      'common.stepByStepTour.guides.integration.autoUpdate.description': 'Turn on Auto-update so installed tool plugins stay on the latest version automatically.',
      'common.stepByStepTour.guides.integration.autoUpdate.title': 'Keep tools up to date',
      'common.stepByStepTour.guides.primaryActionLabel': 'Got it',
      'common.stepByStepTour.guides.studio.empty.blank.description': 'Start from an empty canvas when you already know what to build.',
      'common.stepByStepTour.guides.studio.empty.blank.title': 'Create from blank',
      'common.stepByStepTour.guides.studio.empty.dsl.description': 'Got a Dify DSL file? Import it here to restore an app you have shared or backed up.',
      'common.stepByStepTour.guides.studio.empty.dsl.title': 'Import a DSL file',
      'common.stepByStepTour.guides.studio.empty.learnDify.description': 'New to Dify? Walk through a guided lesson first.',
      'common.stepByStepTour.guides.studio.empty.learnDify.title': 'Or start with Learn Dify',
      'common.stepByStepTour.guides.studio.empty.template.description': 'Browse Dify templates and pick one that matches what you want to build.',
      'common.stepByStepTour.guides.studio.empty.template.title': 'Create from a template',
      'common.stepByStepTour.guides.studio.withApps.create.description': 'Use Create to add a new app — pick from a template, start from blank, or import a DSL file.',
      'common.stepByStepTour.guides.studio.withApps.create.title': 'Create a new app',
      'common.stepByStepTour.guides.studio.withApps.manage.description': 'Tap any app to open its orchestration page — edit prompts, models, and logic, or manage its settings from there.',
      'common.stepByStepTour.guides.studio.withApps.manage.title': 'Open and manage each app',
      'common.stepByStepTour.skip': 'Skip',
      'common.stepByStepTour.minimize': 'Minimize tour',
      'common.stepByStepTour.restore': 'Open step-by-step tour',
      'common.stepByStepTour.learnMore': 'Learn more',
      'common.stepByStepTour.tasks.home.title': 'Try a Learn Dify lesson',
      'common.stepByStepTour.tasks.home.description': 'Open a hands-on lesson from Learn Dify to see Dify in action.',
      'common.stepByStepTour.tasks.home.primaryActionLabel': 'Show me',
      'common.stepByStepTour.tasks.studio.title': 'Manage your apps in Studio',
      'common.stepByStepTour.tasks.studio.description': 'All your apps live in Studio — edit, organize, and publish them here.',
      'common.stepByStepTour.tasks.studio.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.knowledge.title': 'Add your own data',
      'common.stepByStepTour.tasks.knowledge.description': 'Build a knowledge base so your apps answer from your documents.',
      'common.stepByStepTour.tasks.knowledge.primaryActionLabel': 'Take a look',
      'common.stepByStepTour.tasks.integration.title': 'Explore integrations',
      'common.stepByStepTour.tasks.integration.description': 'Models, tools, data sources & more — explore what you can connect.',
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
      role: 'owner',
      created_at: 0,
      providers: [],
      trial_credits: 0,
      trial_credits_used: 0,
      next_credit_reset_date: 0,
    },
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
      expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge'])
      expect(state.minimized).toBe(true)
    })
    expect(mockRouterPush).toHaveBeenCalledWith('/integrations/model-provider')
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
      expect(await screen.findByRole('region', { name: 'Try a Learn Dify lesson' })).toBeInTheDocument()
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

  it('allows users to toggle task completion from the checklist status control', async () => {
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: false,
      completedTaskIds: ['home'],
      skipped: false,
    }))

    render(<StepByStepTourMount />)

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Manage your apps in Studio complete' }))

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.completedTaskIds).toEqual(['home', 'studio'])
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mark Try a Learn Dify lesson incomplete' }))

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
      expect(state.completedTaskIds).toEqual(['studio'])
    })
  })

  it('renders the active guide against the integration target and completes it from Got it', async () => {
    mockPathname = '/integrations/model-provider'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    let targetTop = 114
    const target = document.createElement('div')
    target.dataset.stepByStepTourTarget = STEP_BY_STEP_TOUR_TARGETS.integration
    target.getBoundingClientRect = () => ({
      bottom: targetTop + 64,
      height: 64,
      left: 472,
      right: 1484,
      top: targetTop,
      width: 1012,
      x: 472,
      y: targetTop,
      toJSON: () => ({}),
    })
    document.body.appendChild(target)

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Keep tools up to date' })).toBeInTheDocument()
      const minimizedTourButton = screen.getByRole('button', { name: 'Open step-by-step tour' })
      expect(minimizedTourButton).toBeInTheDocument()
      expect(minimizedTourButton).not.toHaveClass('z-50')
      expect(screen.getByText('4 of 4')).toBeInTheDocument()
      expect(document.body.querySelector('[data-step-by-step-tour-backdrop]')).toBeInTheDocument()
      const highlight = document.body.querySelector('[data-step-by-step-tour-highlight]') as HTMLElement
      const coachmark = document.body.querySelector('[data-step-by-step-tour-coachmark]') as HTMLElement
      const arrow = coachmark.querySelector('[aria-hidden="true"]') as HTMLElement
      expect(highlight).toHaveStyle({ top: '110px' })
      expect(coachmark).toHaveStyle({ left: '472px', top: '198px' })
      expect(arrow).toHaveStyle({ left: '28px' })

      targetTop = 126
      window.dispatchEvent(new Event('scroll'))

      await waitFor(() => {
        expect(highlight).toHaveStyle({ top: '122px' })
        expect(coachmark).toHaveStyle({ top: '210px' })
      })

      setViewportSize({ height: 768, width: 600 })
      window.dispatchEvent(new Event('resize'))

      await waitFor(() => {
        expect(coachmark).toHaveStyle({ left: '240px' })
        expect(arrow).toHaveStyle({ left: '260px' })
      })

      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.completedTaskIds).toEqual(['home', 'studio', 'knowledge', 'integration'])
        expect(state.minimized).toBe(false)
      })
      expect(screen.getByRole('region', { name: 'Get to know Dify' })).toBeInTheDocument()
    }
    finally {
      target.remove()
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

  it('returns to the minimized tour when skipping a single active guide', async () => {
    mockPathname = '/integrations/model-provider'
    localStorage.setItem(STEP_BY_STEP_TOUR_STORAGE_KEY, JSON.stringify({
      activeTaskId: 'integration',
      manuallyEnabledWorkspaceIds: ['workspace-1'],
      manuallyDisabledWorkspaceIds: [],
      minimized: true,
      completedTaskIds: ['home', 'studio', 'knowledge'],
      skipped: false,
    }))
    const target = document.createElement('div')
    target.dataset.stepByStepTourTarget = STEP_BY_STEP_TOUR_TARGETS.integration
    target.getBoundingClientRect = () => ({
      bottom: 178,
      height: 64,
      left: 472,
      right: 1484,
      top: 114,
      width: 1012,
      x: 472,
      y: 114,
      toJSON: () => ({}),
    })
    document.body.appendChild(target)

    try {
      render(<StepByStepTourMount />)

      expect(await screen.findByRole('region', { name: 'Keep tools up to date' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

      await waitFor(() => {
        const state = JSON.parse(localStorage.getItem(STEP_BY_STEP_TOUR_STORAGE_KEY)!)
        expect(state.activeTaskId).toBeUndefined()
        expect(state.minimized).toBe(true)
        expect(state.skipped).toBe(false)
        expect(state.manuallyEnabledWorkspaceIds).toEqual(['workspace-1'])
      })
      expect(screen.getByRole('button', { name: 'Open step-by-step tour' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Keep tools up to date' })).not.toBeInTheDocument()
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
