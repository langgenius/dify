import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeploymentActionsDropdown } from '../deployment-row-actions-menu'

const commonProps = {
  currentReleaseId: 'release-1',
  deployActionLabel: 'Deploy',
  isDeployFailed: false,
  isDeploymentInProgress: false,
  isUndeployed: false,
  onDeploy: vi.fn(),
  onRequestUndeploy: vi.fn(),
  onViewError: vi.fn(),
}

describe('DeploymentActionsDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should keep disabled item state and action behavior in sync', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <DeploymentActionsDropdown {...commonProps} undeployActionDisabled />,
    )

    await user.click(screen.getByLabelText('deployments.deployTab.moreActions'))
    const undeployItem = screen.getByRole('menuitem', {
      name: 'deployments.deployTab.undeploy',
    })
    expect(undeployItem).toHaveAttribute('data-disabled')
    expect(undeployItem).toHaveAttribute('aria-disabled', 'true')
    expect(undeployItem).toHaveClass('data-disabled:cursor-not-allowed', 'data-disabled:opacity-60')

    await user.click(undeployItem)
    expect(commonProps.onRequestUndeploy).not.toHaveBeenCalled()

    rerender(<DeploymentActionsDropdown {...commonProps} undeployActionDisabled={false} />)

    expect(undeployItem).not.toHaveAttribute('data-disabled')
    expect(undeployItem).toHaveAttribute('aria-disabled', 'false')

    await user.click(undeployItem)
    expect(commonProps.onRequestUndeploy).toHaveBeenCalledTimes(1)
  })
})
