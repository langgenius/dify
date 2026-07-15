import { render, screen } from '@testing-library/react'
import { AgentOrchestrateBottomActions } from '../bottom-actions'

describe('AgentOrchestrateBottomActions', () => {
  it('should allow callers to keep the bottom action width when nested content opens', () => {
    const { rerender } = render(
      <AgentOrchestrateBottomActions>
        <div data-testid="bottom-action" />
      </AgentOrchestrateBottomActions>,
    )

    expect(screen.getByTestId('bottom-action').parentElement).toHaveClass(
      'has-[[data-open]]:max-w-96',
    )

    rerender(
      <AgentOrchestrateBottomActions shrinkOnOpen={false}>
        <div data-testid="bottom-action" />
      </AgentOrchestrateBottomActions>,
    )

    expect(screen.getByTestId('bottom-action').parentElement).not.toHaveClass(
      'has-[[data-open]]:max-w-96',
    )
  })
})
