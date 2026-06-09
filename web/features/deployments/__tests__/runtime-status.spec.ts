import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  deploymentStatus,
  deploymentStatusPollingInterval,
  isAvailableDeploymentTarget,
  isUndeployedDeploymentRow,
} from '../runtime-status'

describe('runtime-status', () => {
  // Runtime statuses come from the generated enterprise API contract.
  describe('deployment status mapping', () => {
    it('should render undeploying runtime status as undeploying instead of unknown', () => {
      const row = {
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      } satisfies EnvironmentDeployment

      expect(deploymentStatus(row)).toBe('undeploying')
    })

    it('should not treat undeploying rows as undeployed when release fields are empty', () => {
      const row = {
        environment: {
          id: 'env-undeploying',
        },
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      } satisfies EnvironmentDeployment

      expect(isUndeployedDeploymentRow(row)).toBe(false)
      expect(isAvailableDeploymentTarget(row)).toBe(false)
    })
  })

  describe('deployment status polling', () => {
    it('should keep polling while a deployment is undeploying', () => {
      const rows = [{
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
      }] satisfies EnvironmentDeployment[]

      expect(deploymentStatusPollingInterval(rows)).toBe(3000)
    })
  })
})
