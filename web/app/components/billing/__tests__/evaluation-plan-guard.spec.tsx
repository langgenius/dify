import { screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import EvaluationPlanGuard from '../evaluation-plan-guard'

const mockReplace = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

describe('EvaluationPlanGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children when the workspace can use evaluation', () => {
    renderWithConsoleQuery(
      <EvaluationPlanGuard fallbackHref="/apps">
        <div>Evaluation content</div>
      </EvaluationPlanGuard>,
      {
        features: { evaluation_enabled: true },
      },
    )

    expect(screen.getByText('Evaluation content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it.each([
    ['requires an upgrade', { evaluation_enabled: false, evaluation_upgrade_available: true }],
    [
      'does not offer evaluation',
      { evaluation_enabled: false, evaluation_upgrade_available: false },
    ],
  ])('redirects when the workspace %s', async (_, features) => {
    renderWithConsoleQuery(
      <EvaluationPlanGuard fallbackHref="/apps">
        <div>Evaluation content</div>
      </EvaluationPlanGuard>,
      { features },
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
    expect(screen.queryByText('Evaluation content')).not.toBeInTheDocument()
  })
})
