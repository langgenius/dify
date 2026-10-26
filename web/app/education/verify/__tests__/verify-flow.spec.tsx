import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { EducationVerifyFlow } from '../verify-flow'

const mockReplace = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn(() => null as never))
const mockRequestVerification = vi.hoisted(() => vi.fn())

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/app/education/user-info', () => ({
  default: () => <div>Student account</div>,
}))

function renderFlow({
  allowRefresh = false,
  isEducationAccount = false,
}: {
  allowRefresh?: boolean
  isEducationAccount?: boolean
}) {
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    accountProfile: { email: 'student@university.edu' },
    educationStatus: {
      allow_refresh: allowRefresh,
      is_student: isEducationAccount,
    },
  })
  seedFeatures(queryClient, { education: { enabled: true } })

  return render(<EducationVerifyFlow requestVerification={mockRequestVerification} />, { wrapper })
}

describe('EducationVerifyFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestVerification.mockResolvedValue({ token: 'education-token' })
  })

  it('shows an already verified account', () => {
    renderFlow({ isEducationAccount: true })

    expect(
      screen.getByRole('heading', { name: 'education.applied.step1.description' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'navigation.settings.billing' })).toHaveAttribute(
      'href',
      '/?settings=billing',
    )
  })

  it('requests one token on entry and replaces the route with the application form', async () => {
    mockRequestVerification.mockResolvedValue({ token: 'education token' })
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      accountProfile: { email: 'student@university.edu' },
      educationStatus: { allow_refresh: false, is_student: false },
    })
    seedFeatures(queryClient, { education: { enabled: true } })

    render(
      <StrictMode>
        <EducationVerifyFlow requestVerification={mockRequestVerification} />
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

    renderFlow({})

    expect(
      await screen.findByRole('heading', { name: 'education.rejectTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByText('student@university.edu')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('retries a failed verification and navigates after recovery', async () => {
    const user = userEvent.setup()
    mockRequestVerification.mockRejectedValue(createHttpError(new Response(null, { status: 503 })))

    renderFlow({})

    expect(
      await screen.findByRole('heading', { name: 'common.errorBoundary.title' }),
    ).toBeInTheDocument()
    mockRequestVerification.mockResolvedValue({ token: 'retry-token' })
    await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/education/apply?token=retry-token'),
    )
    expect(mockRequestVerification).toHaveBeenCalledTimes(2)
  })
})
