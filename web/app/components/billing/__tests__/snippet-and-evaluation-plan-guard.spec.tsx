import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import SnippetAndEvaluationPlanGuard from '../snippet-and-evaluation-plan-guard'

const mockReplace = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

describe('SnippetAndEvaluationPlanGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects community deployments without loading subscription data', async () => {
    renderWithConsoleQuery(
      <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
        <div>Evaluation content</div>
      </SnippetAndEvaluationPlanGuard>,
      {
        systemFeatures: { deployment_edition: 'COMMUNITY' },
      },
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
  })

  it('allows enterprise deployments without loading subscription data', () => {
    renderWithConsoleQuery(
      <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
        <div>Evaluation content</div>
      </SnippetAndEvaluationPlanGuard>,
      {
        systemFeatures: { deployment_edition: 'ENTERPRISE' },
      },
    )

    expect(screen.getByText('Evaluation content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('allows professional cloud subscriptions', () => {
    renderWithConsoleQuery(
      <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
        <div>Evaluation content</div>
      </SnippetAndEvaluationPlanGuard>,
      {
        systemFeatures: { deployment_edition: 'CLOUD' },
        features: { billing: { subscription: { plan: 'professional' } } },
      },
    )

    expect(screen.getByText('Evaluation content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('redirects sandbox cloud subscriptions', async () => {
    renderWithConsoleQuery(
      <SnippetAndEvaluationPlanGuard fallbackHref="/apps">
        <div>Evaluation content</div>
      </SnippetAndEvaluationPlanGuard>,
      {
        systemFeatures: { deployment_edition: 'CLOUD' },
        features: { billing: { subscription: { plan: 'sandbox' } } },
      },
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
  })
})
