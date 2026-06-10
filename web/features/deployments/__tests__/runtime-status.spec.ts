import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  deploymentStatusPollingInterval,
  isAvailableDeploymentTarget,
  isUndeployedDeploymentRow,
} from '../runtime-status'

const environment = {
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
} satisfies EnvironmentDeployment['environment']

describe('runtime-status', () => {
  // Runtime statuses come from the generated enterprise API contract.
  describe('deployment status helpers', () => {
    it('should not treat undeploying rows as undeployed when release fields are empty', () => {
      const row = {
        appInstanceId: 'app-instance',
        environment,
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
        updatedAt: '',
      } satisfies EnvironmentDeployment

      expect(isUndeployedDeploymentRow(row)).toBe(false)
      expect(isAvailableDeploymentTarget(row)).toBe(false)
    })
  })

  describe('deployment status polling', () => {
    it('should keep polling while a deployment is undeploying', () => {
      const rows = [{
        appInstanceId: 'app-instance',
        environment,
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
        updatedAt: '',
      }] satisfies EnvironmentDeployment[]

      expect(deploymentStatusPollingInterval(rows)).toBe(3000)
    })
  })
})
