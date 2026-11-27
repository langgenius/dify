import { ORPCError } from '@orpc/client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createConsoleQueryWrapper,
  createFeaturesFixture,
  seedFeatures,
} from '@/test/console/query-data'
import { render } from '@/test/console/render'
import EducationApplyRoute from '../application-entry'

const mockRedirect = vi.hoisted(() => vi.fn(() => null as never))
const mockGetFeatures = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': mockGetFeatures,
    }),
  }
})

vi.mock('../application-form', () => ({
  default: ({ token }: { token: string }) => <div>Application form: {token}</div>,
}))

describe('EducationApplyRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFeatures.mockReturnValue(new Promise(() => {}))
  })

  it('keeps the token URL and offers a retry when the plan fails to load', async () => {
    const user = userEvent.setup()
    mockGetFeatures.mockRejectedValueOnce(
      new ORPCError('internal_server_error', { status: 500, message: 'Backend text' }),
    )
    const { wrapper } = createConsoleQueryWrapper({ features: null })

    render(<EducationApplyRoute token="education-token" />, { wrapper })

    expect(await screen.findByRole('alert')).toHaveTextContent('billing.errors.operationFailed')
    expect(mockRedirect).not.toHaveBeenCalled()
    mockGetFeatures.mockResolvedValueOnce(
      createFeaturesFixture({
        billing: { subscription: { plan: 'sandbox' } },
        education: { enabled: true },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() =>
      expect(screen.getByText('Application form: education-token')).toBeInTheDocument(),
    )
  })

  it('returns to home when the education plan is unavailable', () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    seedFeatures(queryClient, { education: { enabled: false } })

    render(<EducationApplyRoute token="education-token" />, { wrapper })

    expect(mockRedirect).toHaveBeenCalledWith('/')
  })

  it('renders the application form for a direct token URL', () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      educationStatus: { is_student: false },
    })
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'sandbox' } },
      education: { enabled: true },
    })

    render(<EducationApplyRoute token="education-token" />, { wrapper })

    expect(screen.getByText('Application form: education-token')).toBeInTheDocument()
  })
})
