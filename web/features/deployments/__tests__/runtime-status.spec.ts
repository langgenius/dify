import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import {
  DEPLOYMENT_STATUS_POLLING_INTERVAL,
  deploymentStatus,
  deploymentStatusPollingInterval,
  hasRuntimeInstanceDeployment,
  isAvailableDeploymentTarget,
  isUndeployedDeploymentRow,
  RUNTIME_INSTANCE_STATUS_DEPLOYING,
  RUNTIME_INSTANCE_STATUS_DRIFTED,
  RUNTIME_INSTANCE_STATUS_FAILED,
  RUNTIME_INSTANCE_STATUS_INVALID,
  RUNTIME_INSTANCE_STATUS_READY,
  RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
} from '../runtime-status'

describe('deploymentStatus', () => {
  it('should map backend runtime instance statuses to frontend statuses', () => {
    // Arrange & Act & Assert
    expect(deploymentStatus({ status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED })).toBe('not_deployed')
    expect(deploymentStatus({ status: RUNTIME_INSTANCE_STATUS_DEPLOYING })).toBe('deploying')
    expect(deploymentStatus({ status: RUNTIME_INSTANCE_STATUS_READY })).toBe('ready')
    expect(deploymentStatus({ status: RUNTIME_INSTANCE_STATUS_FAILED })).toBe('deploy_failed')
    expect(deploymentStatus({ status: RUNTIME_INSTANCE_STATUS_DRIFTED })).toBe('drifted')
    expect(deploymentStatus({ status: RUNTIME_INSTANCE_STATUS_INVALID })).toBe('invalid')
  })

  it('should map backend proto enum strings to frontend statuses', () => {
    // Arrange & Act & Assert
    expect(deploymentStatus({ status: 'RUNTIME_INSTANCE_STATUS_UNDEPLOYED' })).toBe('not_deployed')
    expect(deploymentStatus({ status: 'RUNTIME_INSTANCE_STATUS_DEPLOYING' })).toBe('deploying')
    expect(deploymentStatus({ status: 'RUNTIME_INSTANCE_STATUS_READY' })).toBe('ready')
    expect(deploymentStatus({ status: 'RUNTIME_INSTANCE_STATUS_FAILED' })).toBe('deploy_failed')
    expect(deploymentStatus({ status: 'RUNTIME_INSTANCE_STATUS_DRIFTED' })).toBe('drifted')
    expect(deploymentStatus({ status: 'RUNTIME_INSTANCE_STATUS_INVALID' })).toBe('invalid')
  })

  it('should return unknown for unspecified or unsupported runtime instance statuses', () => {
    // Arrange & Act & Assert
    expect(deploymentStatus()).toBe('unknown')
    expect(deploymentStatus({ status: 0 })).toBe('unknown')
    expect(deploymentStatus({ status: 99 })).toBe('unknown')
  })
})

describe('isUndeployedDeploymentRow', () => {
  it('should use the runtime instance undeployed status when it is present', () => {
    // Arrange & Act & Assert
    expect(isUndeployedDeploymentRow({
      status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
      currentRelease: { id: 'release-1' },
      desiredRelease: { id: 'release-1' },
      currentDeployment: { id: 'deployment-1' },
    })).toBe(true)
  })

  it('should keep the empty-row fallback for rows without status values', () => {
    // Arrange & Act & Assert
    expect(isUndeployedDeploymentRow({})).toBe(true)
  })
})

describe('runtime instance row helpers', () => {
  it('should distinguish deployed instance rows from available deployment target rows', () => {
    // Arrange
    const readyRow = {
      environment: { id: 'env-ready' },
      status: RUNTIME_INSTANCE_STATUS_READY,
      currentRelease: { id: 'release-1' },
    } satisfies EnvironmentDeployment
    const undeployedRow = {
      environment: { id: 'env-empty' },
      status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
    } satisfies EnvironmentDeployment

    // Act & Assert
    expect(hasRuntimeInstanceDeployment(readyRow)).toBe(true)
    expect(isAvailableDeploymentTarget(readyRow)).toBe(false)
    expect(hasRuntimeInstanceDeployment(undeployedRow)).toBe(false)
    expect(isAvailableDeploymentTarget(undeployedRow)).toBe(true)
  })

  it('should ignore rows without an environment id', () => {
    // Arrange
    const readyRowWithoutEnvironment = {
      status: RUNTIME_INSTANCE_STATUS_READY,
      currentRelease: { id: 'release-1' },
    } satisfies EnvironmentDeployment

    // Act & Assert
    expect(hasRuntimeInstanceDeployment(readyRowWithoutEnvironment)).toBe(false)
    expect(isAvailableDeploymentTarget(readyRowWithoutEnvironment)).toBe(false)
  })
})

describe('deploymentStatusPollingInterval', () => {
  it('should poll only while at least one runtime instance is deploying', () => {
    // Arrange & Act & Assert
    expect(deploymentStatusPollingInterval({
      data: [
        { status: RUNTIME_INSTANCE_STATUS_READY },
        { status: RUNTIME_INSTANCE_STATUS_DEPLOYING },
      ],
    })).toBe(DEPLOYMENT_STATUS_POLLING_INTERVAL)
    expect(deploymentStatusPollingInterval({
      data: [
        { status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED },
        { status: RUNTIME_INSTANCE_STATUS_READY },
      ],
    })).toBe(false)
  })
})
