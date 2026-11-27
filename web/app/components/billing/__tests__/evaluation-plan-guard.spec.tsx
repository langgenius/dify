import { ORPCError } from '@orpc/client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createFeaturesFixture, renderWithConsoleQuery } from '@/test/console/query-data'
import EvaluationPlanGuard from '../evaluation-plan-guard'

const mockReplace = vi.fn()
const mockGetFeatures = vi.hoisted(() => vi.fn())

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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/app/components/evaluation/upgrade-preview', () => ({
  default: ({ resourceType }: { resourceType: string }) => (
    <div>Evaluation upgrade preview: {resourceType}</div>
  ),
}))

describe('EvaluationPlanGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFeatures.mockReturnValue(new Promise(() => {}))
  })

  it('shows a failed plan load with a retry instead of a lasting spinner', async () => {
    const user = userEvent.setup()
    mockGetFeatures.mockRejectedValueOnce(
      new ORPCError('internal_server_error', { status: 500, message: 'Backend text' }),
    )
    renderWithConsoleQuery(
      <EvaluationPlanGuard fallbackHref="/apps" resourceType="apps">
        <div>Evaluation content</div>
      </EvaluationPlanGuard>,
      { features: null },
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('billing.errors.operationFailed')
    mockGetFeatures.mockResolvedValueOnce(createFeaturesFixture({ evaluation_enabled: true }))
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(await screen.findByText('Evaluation content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('renders children when the workspace can use evaluation', () => {
    renderWithConsoleQuery(
      <EvaluationPlanGuard fallbackHref="/apps" resourceType="apps">
        <div>Evaluation content</div>
      </EvaluationPlanGuard>,
      {
        features: { evaluation_enabled: true },
      },
    )

    expect(screen.getByText('Evaluation content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('previews evaluation instead of the content when an upgrade unlocks it', () => {
    renderWithConsoleQuery(
      <EvaluationPlanGuard fallbackHref="/apps" resourceType="datasets">
        <div>Evaluation content</div>
      </EvaluationPlanGuard>,
      { features: { evaluation_enabled: false, evaluation_upgrade_available: true } },
    )

    expect(screen.getByText('Evaluation upgrade preview: datasets')).toBeInTheDocument()
    expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects when the workspace does not offer evaluation', async () => {
    renderWithConsoleQuery(
      <EvaluationPlanGuard fallbackHref="/apps" resourceType="apps">
        <div>Evaluation content</div>
      </EvaluationPlanGuard>,
      { features: { evaluation_enabled: false, evaluation_upgrade_available: false } },
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
  })
})
