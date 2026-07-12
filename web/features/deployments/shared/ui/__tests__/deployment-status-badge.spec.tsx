import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeploymentStatusBadge } from '../deployment-status-badge'

describe('DeploymentStatusBadge', () => {
  it('should keep the original badge style by default', () => {
    const { container } = render(
      <DeploymentStatusBadge
        status={RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY}
        label="Running"
      />,
    )

    const badge = screen.getByText('Running').parentElement

    expect(badge).toHaveClass(
      'border',
      'rounded-md',
      'bg-util-colors-green-green-50',
      'system-2xs-medium-uppercase',
    )
    expect(container.querySelector('.bg-util-colors-green-green-500')).not.toBeInTheDocument()
    expect(container.querySelector('.shadow-status-indicator-green-shadow')).toBeInTheDocument()
  })

  it('should render the status-dot variant like knowledge list status', () => {
    const { container } = render(
      <DeploymentStatusBadge
        status={RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY}
        label="Running"
        variant="status-dot"
      />,
    )

    const badge = screen.getByText('Running').parentElement

    expect(badge).not.toHaveClass('border', 'rounded-md', 'bg-util-colors-green-green-50')
    expect(badge).toHaveClass('system-2xs-medium-uppercase')
    expect(screen.getByText('Running')).not.toHaveClass('text-sm')
    expect(screen.getByText('Running')).toHaveClass('text-util-colors-green-green-600')
    expect(container.querySelector('.shadow-status-indicator-green-shadow')).toBeInTheDocument()
  })

  it('should keep the status dot pulsing for in-progress statuses', () => {
    const { container } = render(
      <DeploymentStatusBadge
        status={RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING}
        label="Deploying"
        variant="status-dot"
      />,
    )

    expect(screen.getByText('Deploying')).toHaveClass('text-util-colors-blue-light-blue-light-600')
    expect(container.querySelector('.shadow-status-indicator-blue-shadow')).toHaveClass(
      'animate-pulse',
    )
  })
})
