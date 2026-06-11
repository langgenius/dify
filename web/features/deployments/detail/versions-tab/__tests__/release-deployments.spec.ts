import type { ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { getReleaseSummaryDeployments } from '../release-deployments'

function environment(id: string, name: string): ReleaseSummary['deployedEnvironments'][number]['environment'] {
  return {
    id,
    displayName: name,
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
  }
}

describe('release-deployments', () => {
  // Runtime statuses come from the generated enterprise API contract.
  describe('release summary deployments', () => {
    it('should keep runtime status values on release deployment rows', () => {
      const summary = {
        release: {
          id: 'release',
          appInstanceId: 'app-instance',
          displayName: 'Release',
          description: '',
          source: 'RELEASE_SOURCE_UPLOAD',
          sourceAppId: '',
          gateCommitId: '',
          requiredSlots: [],
          createdBy: {
            id: 'account',
            displayName: 'Account',
          },
          createdAt: '',
        },
        deployedEnvironments: [
          {
            environment: environment('env-ready', 'Ready'),
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
          },
          {
            environment: environment('env-deploying', 'Deploying'),
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING,
          },
          {
            environment: environment('env-failed', 'Failed'),
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED,
          },
          {
            environment: environment('env-invalid', 'Invalid'),
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID,
          },
          {
            environment: environment('env-undeploying', 'Undeploying'),
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
          },
        ],
        environmentActions: [],
        activeEnvironmentCount: 5,
      } satisfies ReleaseSummary

      expect(getReleaseSummaryDeployments(summary)).toEqual([
        {
          environmentId: 'env-ready',
          environmentName: 'Ready',
          status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
        },
        {
          environmentId: 'env-deploying',
          environmentName: 'Deploying',
          status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING,
        },
        {
          environmentId: 'env-failed',
          environmentName: 'Failed',
          status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED,
        },
        {
          environmentId: 'env-invalid',
          environmentName: 'Invalid',
          status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID,
        },
        {
          environmentId: 'env-undeploying',
          environmentName: 'Undeploying',
          status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
        },
      ])
    })
  })
})
