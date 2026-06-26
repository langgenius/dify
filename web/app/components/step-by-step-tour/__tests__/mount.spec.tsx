import type { AppContextValue } from '@/context/app-context'
import { render, screen } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import { STEP_BY_STEP_TOUR_STORAGE_KEY } from '../constants'
import StepByStepTourMount from '../mount'

vi.mock('@/config', () => ({
  IS_CLOUD_EDITION: true,
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/apps',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: {
      id: 'workspace-1',
      name: 'Solar Studio',
      plan: Plan.sandbox,
      status: 'normal',
      role: 'owner',
      current: true,
      provider: 'dify',
      created_at: 0,
    },
  } satisfies Partial<AppContextValue>),
}))

describe('StepByStepTourMount', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
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

    expect(await screen.findByRole('region', { name: 'Step-by-step Tour' })).toBeInTheDocument()
    expect(screen.getByText('about 5 minutes')).toBeInTheDocument()
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

    const checklist = await screen.findByRole('region', { name: 'Step-by-step Tour' })
    const popoverPopup = checklist.parentElement
    const popoverPositioner = popoverPopup?.parentElement

    expect(checklist.closest('[data-base-ui-portal]')).toBeInTheDocument()
    expect(popoverPositioner).toHaveClass('z-50')
    expect(popoverPositioner).toHaveAttribute('data-side', 'top')
    expect(popoverPositioner).toHaveAttribute('data-align', 'start')
    expect(popoverPopup).toHaveClass('max-h-[calc(100vh-16px)]', 'overflow-y-auto')
  })
})
