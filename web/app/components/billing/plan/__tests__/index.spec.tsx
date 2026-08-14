import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { baseProviderContextValue } from '@/context/provider-context'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import PlanComp from '../index'

const mocks = vi.hoisted(() => ({
  allowRefreshEducationVerify: false,
  isEducationAccount: false,
  mutateAsync: vi.fn(),
  push: vi.fn(),
  setEducationVerifying: vi.fn(),
  setShowAccountSettingModal: vi.fn(),
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
      allowRefreshEducationVerify: mocks.allowRefreshEducationVerify,
      enableEducationPlan: true,
      isEducationAccount: mocks.isEducationAccount,
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/billing',
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setShowAccountSettingModal: mocks.setShowAccountSettingModal }),
}))

vi.mock('@/app/education-apply/storage', () => ({
  useSetEducationVerifying: () => mocks.setEducationVerifying,
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
  mocks.allowRefreshEducationVerify = educationStatus.allow_refresh
  mocks.isEducationAccount = educationStatus.is_student
  const { wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })

  return render(<PlanComp loc="billing-page" />, { wrapper })
}

describe('PlanComp education discount', () => {
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

  it('starts education verification and opens the application form', async () => {
    const user = userEvent.setup()
    mocks.mutateAsync.mockResolvedValue({ token: 'education-token' })
    renderPlan()

    await user.click(screen.getByRole('button', { name: 'education.toVerified' }))

    expect(mocks.mutateAsync).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/education-apply?token=education-token')
    })
  })
})
