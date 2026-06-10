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
        appInstanceId: 'app-instance',
        environment: {
          id: 'env-undeploying',
          name: 'Test CPU',
          description: '',
          mode: 'ENVIRONMENT_MODE_SHARED',
          backend: 'RUNTIME_BACKEND_K8S',
          namespace: '',
          apiServer: '',
          status: 'ENVIRONMENT_STATUS_READY',
          statusMessage: '',
          managedBy: '',
          createdAt: '',
          updatedAt: '',
          runtimeEndpoint: '',
          cpuCount: 1,
        },
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
        updatedAt: '',
      } satisfies EnvironmentDeployment

      render(<DeploymentStatusSummary row={row} />)

      expect(screen.getByText('deployments.status.RUNTIME_INSTANCE_STATUS_UNDEPLOYING')).toBeInTheDocument()
      expect(screen.queryByText('deployments.status.RUNTIME_INSTANCE_STATUS_UNSPECIFIED')).not.toBeInTheDocument()
      expect(screen.queryByText('deployments.status.RUNTIME_INSTANCE_STATUS_UNDEPLOYED')).not.toBeInTheDocument()
    })
  })
})
