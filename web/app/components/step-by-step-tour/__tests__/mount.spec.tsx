import type { AppContextValue } from '@/context/app-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { STEP_BY_STEP_TOUR_STORAGE_KEY } from '../constants'
import StepByStepTourMount from '../mount'
import { STEP_BY_STEP_TOUR_TARGETS } from '../target-registry'

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
      expect(highlight).toHaveStyle({ top: '114px' })
      expect(coachmark).toHaveStyle({ left: '472px', top: '198px' })
      expect(arrow).toHaveStyle({ left: '28px' })

      targetTop = 126

      await waitFor(() => {
        expect(highlight).toHaveStyle({ top: '126px' })
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
