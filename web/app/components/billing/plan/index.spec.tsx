import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { Plan } from '../type'
import PlanComp from './index'

let currentPath = '/billing'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => currentPath,
}))

const setShowAccountSettingModalMock = vi.fn()
vi.mock('@/context/modal-context', () => ({
  // eslint-disable-next-line ts/no-explicit-any
  useModalContextSelector: (selector: any) => selector({
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
  // eslint-disable-next-line ts/no-explicit-any
  default: (props: any) => verifyStateModalMock(props),
}))

vi.mock('../upgrade-btn', () => ({
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
})
