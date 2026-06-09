import type { ReleaseSummary } from '@dify/contracts/enterprise/types.gen'
import { RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { getReleaseSummaryDeployments } from '../release-deployments'

describe('release-deployments', () => {
  // Runtime statuses come from the generated enterprise API contract.
  describe('release summary deployments', () => {
    it('should map runtime status values to release deployment states', () => {
      const summary = {
        deployedEnvironments: [
          {
            environment: {
              id: 'env-ready',
              name: 'Ready',
            },
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
          },
          {
            environment: {
              id: 'env-deploying',
              name: 'Deploying',
            },
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_DEPLOYING,
          },
          {
            environment: {
              id: 'env-failed',
              name: 'Failed',
            },
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_FAILED,
          },
          {
            environment: {
              id: 'env-invalid',
              name: 'Invalid',
            },
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_INVALID,
          },
          {
            environment: {
              id: 'env-undeploying',
              name: 'Undeploying',
            },
            status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_UNDEPLOYING,
          },
        ],
      } satisfies ReleaseSummary

      expect(getReleaseSummaryDeployments(summary)).toEqual([
        {
          environmentId: 'env-ready',
          environmentName: 'Ready',
          state: 'active',
        },
        {
          environmentId: 'env-deploying',
          environmentName: 'Deploying',
          state: 'deploying',
        },
        {
          environmentId: 'env-failed',
          environmentName: 'Failed',
          state: 'failed',
        },
        {
          environmentId: 'env-invalid',
          environmentName: 'Invalid',
          state: 'failed',
        },
        {
          environmentId: 'env-undeploying',
          environmentName: 'Undeploying',
          state: 'deploying',
        },
      ])
    })
  })
})
