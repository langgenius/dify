import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import EvaluationPlanGuard from '../evaluation-plan-guard'

const mockReplace = vi.fn()

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
