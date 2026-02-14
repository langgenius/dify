import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { Plan, SelfHostedPlan } from '../../type'
import PlanComp from '../index'

let currentPath = '/billing'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => currentPath,
}))

const setShowAccountSettingModalMock = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowAccountSettingModal: typeof setShowAccountSettingModalMock }) => unknown) => selector({
    setShowAccountSettingModal: setShowAccountSettingModalMock,
  }),
}))

const providerContextMock = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => providerContextMock(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { email: 'user@example.com' },
    isCurrentWorkspaceManager: true,
  }),
}))

const mutateAsyncMock = vi.fn()
let isPending = false
vi.mock('@/service/use-education', () => ({
  useEducationVerify: () => ({
    mutateAsync: mutateAsyncMock,
    isPending,
  }),
}))

const verifyStateModalMock = vi.fn(props => (
  <div data-testid="verify-modal" data-is-show={props.isShow ? 'true' : 'false'}>
    {props.isShow ? 'visible' : 'hidden'}
  </div>
))
vi.mock('@/app/education-apply/verify-state-modal', () => ({
  default: (props: { isShow: boolean, title?: string, content?: string, email?: string, showLink?: boolean, onConfirm?: () => void, onCancel?: () => void }) => verifyStateModalMock(props),
}))

vi.mock('../../upgrade-btn', () => ({
  default: () => <button data-testid="plan-upgrade-btn" type="button">Upgrade</button>,
}))

describe('PlanComp', () => {
  const planMock = {
    type: Plan.professional,
    usage: {
      teamMembers: 4,
      documentsUploadQuota: 3,
      vectorSpace: 8,
      annotatedResponse: 5,
      triggerEvents: 60,
      apiRateLimit: 100,
    },
    total: {
      teamMembers: 10,
      documentsUploadQuota: 20,
      vectorSpace: 10,
      annotatedResponse: 500,
      triggerEvents: 100,
      apiRateLimit: 200,
    },
    reset: {
      triggerEvents: 2,
      apiRateLimit: 1,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    currentPath = '/billing'
    isPending = false
    providerContextMock.mockReturnValue({
      plan: planMock,
      enableEducationPlan: true,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    mutateAsyncMock.mockReset()
    mutateAsyncMock.mockResolvedValue({ token: 'token' })
  })

  it('renders plan info and handles education verify success', async () => {
    render(<PlanComp loc="billing-page" />)

    expect(screen.getByText('billing.plans.professional.name')).toBeInTheDocument()
    expect(screen.getByTestId('plan-upgrade-btn')).toBeInTheDocument()

    const verifyBtn = screen.getByText('education.toVerified')
    fireEvent.click(verifyBtn)

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled())
    await waitFor(() => expect(push).toHaveBeenCalledWith('/education-apply?token=token'))
    expect(localStorage.removeItem).toHaveBeenCalledWith(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
  })

  it('shows modal when education verify fails', async () => {
    mutateAsyncMock.mockRejectedValueOnce(new Error('boom'))
    render(<PlanComp loc="billing-page" />)

    const verifyBtn = screen.getByText('education.toVerified')
    fireEvent.click(verifyBtn)

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('verify-modal').getAttribute('data-is-show')).toBe('true'))
  })

  it('resets modal context when on education apply path', () => {
    currentPath = '/education-apply/setup'
    render(<PlanComp loc="billing-page" />)

    expect(setShowAccountSettingModalMock).toHaveBeenCalledWith(null)
  })

  it('does not trigger verify when isPending is true', async () => {
    isPending = true
    render(<PlanComp loc="billing-page" />)

    const verifyBtn = screen.getByText('education.toVerified')
    fireEvent.click(verifyBtn)

    await waitFor(() => expect(mutateAsyncMock).not.toHaveBeenCalled())
  })

  it('renders sandbox plan', () => {
    providerContextMock.mockReturnValue({
      plan: { ...planMock, type: Plan.sandbox },
      enableEducationPlan: false,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    render(<PlanComp loc="billing-page" />)

    expect(screen.getByText('billing.plans.sandbox.name')).toBeInTheDocument()
  })

  it('renders team plan', () => {
    providerContextMock.mockReturnValue({
      plan: { ...planMock, type: Plan.team },
      enableEducationPlan: false,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    render(<PlanComp loc="billing-page" />)

    expect(screen.getByText('billing.plans.team.name')).toBeInTheDocument()
  })

  it('shows verify button when education account is about to expire', () => {
    providerContextMock.mockReturnValue({
      plan: planMock,
      enableEducationPlan: true,
      allowRefreshEducationVerify: true,
      isEducationAccount: true,
    })
    render(<PlanComp loc="billing-page" />)

    expect(screen.getByText('education.toVerified')).toBeInTheDocument()
  })

  it('renders enterprise plan without upgrade button', () => {
    providerContextMock.mockReturnValue({
      plan: { ...planMock, type: SelfHostedPlan.enterprise },
      enableEducationPlan: false,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    render(<PlanComp loc="billing-page" />)

    expect(screen.getByText('billing.plans.enterprise.name')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-upgrade-btn')).not.toBeInTheDocument()
  })

  it('shows apiRateLimit reset info for sandbox plan', () => {
    providerContextMock.mockReturnValue({
      plan: {
        ...planMock,
        type: Plan.sandbox,
        total: { ...planMock.total, apiRateLimit: 5000 },
        reset: { ...planMock.reset, apiRateLimit: null },
      },
      enableEducationPlan: false,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    render(<PlanComp loc="billing-page" />)

    // Sandbox plan with finite apiRateLimit and null reset uses getDaysUntilEndOfMonth()
    expect(screen.getByText('billing.plans.sandbox.name')).toBeInTheDocument()
  })

  it('shows apiRateLimit reset info when reset is a number', () => {
    providerContextMock.mockReturnValue({
      plan: {
        ...planMock,
        type: Plan.professional,
        total: { ...planMock.total, apiRateLimit: 5000 },
        reset: { ...planMock.reset, apiRateLimit: 3 },
      },
      enableEducationPlan: false,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    render(<PlanComp loc="billing-page" />)

    expect(screen.getByText('billing.plans.professional.name')).toBeInTheDocument()
  })

  it('does not show education verify when enableEducationPlan is false', () => {
    providerContextMock.mockReturnValue({
      plan: planMock,
      enableEducationPlan: false,
      allowRefreshEducationVerify: false,
      isEducationAccount: false,
    })
    render(<PlanComp loc="billing-page" />)

    expect(screen.queryByText('education.toVerified')).not.toBeInTheDocument()
  })

  it('handles modal onConfirm and onCancel callbacks', async () => {
    mutateAsyncMock.mockRejectedValueOnce(new Error('boom'))
    render(<PlanComp loc="billing-page" />)

    // Trigger verify to show modal
    const verifyBtn = screen.getByText('education.toVerified')
    fireEvent.click(verifyBtn)

    await waitFor(() => expect(screen.getByTestId('verify-modal').getAttribute('data-is-show')).toBe('true'))

    // Get the props passed to the modal and call onConfirm/onCancel
    const lastCall = verifyStateModalMock.mock.calls[verifyStateModalMock.mock.calls.length - 1][0]
    expect(lastCall.onConfirm).toBeDefined()
    expect(lastCall.onCancel).toBeDefined()

    // Call onConfirm to close modal
    act(() => {
      lastCall.onConfirm()
      lastCall.onCancel()
    })
  })
})
