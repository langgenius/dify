import { screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { EducationVerifyFlow } from '../verify-flow'

const mockReplace = vi.hoisted(() => vi.fn())
const mockRequestVerification = vi.hoisted(() => vi.fn())
const mockProviderContext = vi.hoisted(() => ({
  enableEducationPlan: true,
  isFetchedPlanInfo: true,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: typeof mockProviderContext) => unknown) =>
    selector(mockProviderContext),
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => ({
    userProfile: { email: 'student@university.edu' },
  }))
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/app/education/user-info', () => ({
  default: () => <div>Student account</div>,
}))

function renderFlow({
  applicationsPaused,
  allowRefresh = false,
  isEducationAccount = false,
}: {
  applicationsPaused: boolean
  allowRefresh?: boolean
  isEducationAccount?: boolean
}) {
  const { wrapper } = createConsoleQueryWrapper({
    educationStatus: {
      allow_refresh: allowRefresh,
      is_student: isEducationAccount,
    },
  })

  return render(
    <EducationVerifyFlow
      applicationsPaused={applicationsPaused}
      requestVerification={mockRequestVerification}
    />,
    { wrapper },
  )
}

describe('EducationVerifyFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestVerification.mockResolvedValue({ token: 'education-token' })
  })

  it('renders the pause state without requesting a verification token', () => {
    renderFlow({ applicationsPaused: true })

    expect(
      screen.getByRole('heading', { name: 'education.educationDiscountPaused.title' }),
    ).toBeInTheDocument()
    expect(mockRequestVerification).not.toHaveBeenCalled()
  })

  it('shows an already verified account before the pause gate', () => {
    renderFlow({ applicationsPaused: true, isEducationAccount: true })

    expect(
      screen.getByRole('heading', { name: 'education.applied.step1.description' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.settings.billing' })).toHaveAttribute(
      'href',
      '/?settings=billing',
    )
  })

  it('requests one token on entry and replaces the route with the application form', async () => {
    mockRequestVerification.mockResolvedValue({ token: 'education token' })
    const { wrapper } = createConsoleQueryWrapper({
      educationStatus: { allow_refresh: false, is_student: false },
    })

    render(
      <StrictMode>
        <EducationVerifyFlow
          applicationsPaused={false}
          requestVerification={mockRequestVerification}
        />
      </StrictMode>,
      { wrapper },
    )

    await waitFor(() => {
      expect(mockRequestVerification).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith('/education/apply?token=education%20token')
    })
  })

  it('renders the rejection state when verification returns no token', async () => {
    mockRequestVerification.mockResolvedValue({ token: null })

    renderFlow({ applicationsPaused: false })

    expect(
      await screen.findByRole('heading', { name: 'education.rejectTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByText('student@university.edu')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
