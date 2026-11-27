import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import EvaluationUpgradePreview from '../upgrade-preview'

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ loc }: { loc?: string }) => <button type="button">Upgrade from {loc}</button>,
}))

describe('EvaluationUpgradePreview', () => {
  it('prompts an upgrade above a sample that cannot be operated', () => {
    const { container } = renderWithConsoleQuery(<EvaluationUpgradePreview resourceType="apps" />)

    expect(screen.getByText('evaluation.upgradePreview.title')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Upgrade from evaluation-preview' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Faithfulness').length).toBeGreaterThan(0)
    expect(screen.getByText('Answer Relevancy')).toBeInTheDocument()
    // The sample sits in an inert subtree, so its controls are not reachable.
    expect(container.querySelector('[inert]')).toContainElement(
      screen.getByText('evaluation.batch.uploadAndRun'),
    )
  })

  it('shows the knowledge base metrics as a fixed list', () => {
    renderWithConsoleQuery(<EvaluationUpgradePreview resourceType="datasets" />)

    expect(screen.getByText('Context Recall')).toBeInTheDocument()
    expect(screen.queryByText('Faithfulness')).not.toBeInTheDocument()
  })
})
