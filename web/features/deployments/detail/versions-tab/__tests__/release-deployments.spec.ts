import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_INSTANCE_STATUS_DEPLOYING,
  RUNTIME_INSTANCE_STATUS_READY,
} from '../../../runtime-status'
import { getReleaseDeployments } from '../release-deployments'

describe('getReleaseDeployments', () => {
  it('should return runtime deployment state for the target release', () => {
    // Arrange
    const releaseRow = {
      id: 'release-1',
    } satisfies Release
    const deploymentRows = [
      {
        currentDeployment: { id: 'deployment-1' },
        environment: {
          id: 'env-1',
          name: 'Production',
        },
        status: RUNTIME_INSTANCE_STATUS_READY,
        currentRelease: {
          id: 'release-1',
        },
      },
    ] satisfies EnvironmentDeployment[]

    // Act
    const result = getReleaseDeployments(releaseRow, deploymentRows)

    // Assert
    expect(result).toEqual([
      {
        environmentId: 'env-1',
        environmentName: 'Production',
        state: 'active',
      },
    ])
  })

  it('should only include runtime deployments from the new release contract', () => {
    // Arrange
    const releaseRow = {
      id: 'release-1',
    } satisfies Release
    const deploymentRows = [
      {
        currentDeployment: { id: 'deployment-2' },
        environment: {
          id: 'env-2',
          name: 'Staging',
        },
        status: RUNTIME_INSTANCE_STATUS_DEPLOYING,
        currentRelease: {
          id: 'release-1',
        },
      },
    ] satisfies EnvironmentDeployment[]

    // Act
    const result = getReleaseDeployments(releaseRow, deploymentRows)

    // Assert
    expect(result).toEqual([
      {
        environmentId: 'env-2',
        environmentName: 'Staging',
        state: 'deploying',
      },
    ])
  })

  it('should return no deployments when the release row has no release id', () => {
    // Arrange
    const releaseRow = {
    } satisfies Release

    // Act
    const result = getReleaseDeployments(releaseRow, [])

    // Assert
    expect(result).toEqual([])
  })
})
