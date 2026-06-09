import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeploymentStatusSummary } from '../deployment-status-summary'

describe('DeploymentStatusSummary', () => {
  // Runtime status should dominate empty release/deployment fields.
  describe('Status rendering', () => {
    it('should render undeploying instead of unknown when runtime is undeploying', () => {
      const row = {
        environment: {
          id: 'env-undeploying',
          name: 'Test CPU',
        },
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      } satisfies EnvironmentDeployment

      render(<DeploymentStatusSummary row={row} />)

      expect(screen.getByText('deployments.status.undeploying')).toBeInTheDocument()
      expect(screen.queryByText('deployments.status.unknown')).not.toBeInTheDocument()
      expect(screen.queryByText('deployments.status.notDeployed')).not.toBeInTheDocument()
    })
  })
})
