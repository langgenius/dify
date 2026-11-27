import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import {
  createConsoleQueryWrapper,
  createFeaturesFixture,
  seedFeatures,
} from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { EducationVerifyFlow } from '../verify-flow'

const mockReplace = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn(() => null as never))
const mockRequestVerification = vi.hoisted(() => vi.fn())
const mockGetFeatures = vi.hoisted(() => vi.fn())
const mockGetEducationStatus = vi.hoisted(() => vi.fn())

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'account.education.verify.get': mockRequestVerification,
      'features.get': mockGetFeatures,
      'account.education.get': mockGetEducationStatus,
    }),
  }
})

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

  return { queryClient, ...render(<EducationVerifyFlow />, { wrapper }) }
}

describe('EducationVerifyFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestVerification.mockResolvedValue({ status: 'eligible', token: 'education-token' })
    mockGetFeatures.mockReturnValue(new Promise(() => {}))
    mockGetEducationStatus.mockReturnValue(new Promise(() => {}))
  })

  it('offers a retry instead of leaving when the plan fails to load', async () => {
    const user = userEvent.setup()
    mockGetFeatures.mockRejectedValueOnce(createHttpError(new Response(null, { status: 503 })))
    const { wrapper } = createConsoleQueryWrapper({
      accountProfile: { email: 'student@university.edu' },
      educationStatus: { allow_refresh: false, is_student: true },
      features: null,
    })

    render(<EducationVerifyFlow />, { wrapper })

    expect(
      await screen.findByRole('heading', { name: 'common.errorBoundary.title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('billing.errors.operationFailed')).toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
    mockGetFeatures.mockResolvedValueOnce(createFeaturesFixture({ education: { enabled: true } }))
    await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))

    expect(
      await screen.findByRole('heading', { name: 'education.applied.step1.description' }),
    ).toBeInTheDocument()
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

  it('keeps the cached status on screen when a refetch fails', async () => {
    const { queryClient } = renderFlow({ isEducationAccount: true })
    mockGetEducationStatus.mockRejectedValueOnce(
      createHttpError(new Response(null, { status: 503 })),
    )

    const queryKey = consoleQuery.account.education.get.queryKey()
    // TanStack Query notifies observers on the next macrotask; flush it inside act.
    await act(async () => {
      await queryClient.refetchQueries({ queryKey })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockGetEducationStatus).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryState(queryKey)?.status).toBe('error')

    expect(
      screen.getByRole('heading', { name: 'education.applied.step1.description' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'common.errorBoundary.title' }),
    ).not.toBeInTheDocument()
  })

  it('requests one token on entry and replaces the route with the application form', async () => {
    mockRequestVerification.mockResolvedValue({ status: 'eligible', token: 'education token' })
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      accountProfile: { email: 'student@university.edu' },
      educationStatus: { allow_refresh: false, is_student: false },
    })
    seedFeatures(queryClient, { education: { enabled: true } })

    render(
      <StrictMode>
        <EducationVerifyFlow />
      </StrictMode>,
      { wrapper },
    )

    await waitFor(() => {
      expect(mockRequestVerification).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith('/education/apply?token=education%20token')
    })
  })

  it('renders the rejection state when the account is not eligible', async () => {
    mockRequestVerification.mockResolvedValue({ status: 'not_eligible' })

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
    expect(screen.getByText('billing.errors.operationFailed')).toBeInTheDocument()
    mockRequestVerification.mockResolvedValue({ status: 'eligible', token: 'retry-token' })
    await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/education/apply?token=retry-token'),
    )
    expect(mockRequestVerification).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['education_verify_failed', 400, 'education.verifyFailed'],
    ['education_verify_limit', 429, 'education.tooManyAttempts'],
    ['billing_request_in_progress', 429, 'billing.errors.requestInProgress'],
    ['billing_unavailable', 503, 'billing.errors.unavailable'],
  ])('offers a retry for %s', async (code, status, message) => {
    mockRequestVerification.mockRejectedValue(
      new ORPCError(code, { defined: true, status, message: 'Backend text' }),
    )

    renderFlow({})

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('Backend text')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }),
    ).toBeInTheDocument()
  })
})
