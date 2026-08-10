import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { baseProviderContextValue } from '@/context/provider-context'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import PlanComp from '../index'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => ({
    userProfile: { email: 'user@example.com' },
  }))
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceManager: false,
  }))
})

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: () => ({
      ...baseProviderContextValue,
      enableEducationPlan: true,
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/service/use-education', () => ({
  useEducationVerify: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}))

vi.mock('@/app/components/billing/hooks/use-education-discount', () => ({
  useEducationDiscount: () => ({
    handleEducationDiscount: vi.fn(),
    isEducationDiscountLoading: false,
  }),
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <button type="button">View Plan</button>,
}))

vi.mock('@/app/components/billing/usage-info', () => ({
  default: () => null,
}))

vi.mock('@/app/components/billing/usage-info/apps-info', () => ({
  default: () => null,
}))

vi.mock('@/app/components/billing/usage-info/vector-space-info', () => ({
  default: () => null,
}))

vi.mock('../assets', () => ({
  Enterprise: () => null,
  Professional: () => null,
  Sandbox: () => null,
  Team: () => null,
}))

const renderPlan = (educationStatus = { allow_refresh: false, is_student: false }) => {
  const { wrapper } = createConsoleQueryWrapper({
    educationStatus,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })

  return render(<PlanComp loc="billing-page" />, { wrapper })
}

describe('PlanComp education discount pause', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows education verification before View Plan when the original eligibility allows it', () => {
    renderPlan()

    const educationButton = screen.getByRole('button', { name: 'education.toVerified' })
    const viewPlanButton = screen.getByRole('button', { name: 'View Plan' })

    expect(
      educationButton.compareDocumentPosition(viewPlanButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hides education verification for a verified account that is not expiring', () => {
    renderPlan({ allow_refresh: false, is_student: true })

    expect(screen.queryByRole('button', { name: 'education.toVerified' })).not.toBeInTheDocument()
  })

  it('shows the pause notice instead of starting verification and closes it with OK', async () => {
    const user = userEvent.setup()
    renderPlan()

    await user.click(screen.getByRole('button', { name: 'education.toVerified' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('education.educationDiscountPaused.title')
    expect(dialog).toHaveTextContent('education.educationDiscountPaused.description')
    expect(dialog).toHaveTextContent('education.educationDiscountPaused.thanks')
    expect(dialog).toHaveTextContent('education.educationDiscountPaused.publishedAt')
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
    expect(within(dialog).getByRole('button')).toHaveAccessibleName('common.operation.ok')
    expect(mocks.mutateAsync).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
